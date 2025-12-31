"""Data fetcher for GIOŚ Air Quality API.

Implements rate limiting and retry logic based on official GIOŚ API documentation:
- Archival data: max 2 requests per minute
- Max page size: 500
- Handles 429 (rate limit), 500/502/503/504 (server errors)
"""
import httpx
import asyncio
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dateutil.relativedelta import relativedelta


class GiosRateLimitError(Exception):
    """Raised when API returns 429 Too Many Requests."""
    pass


class GiosServerError(Exception):
    """Raised when API returns 5xx errors."""
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        super().__init__(message)


class GiosDataFetcher:
    """Fetches air quality data from GIOŚ API with rate limiting."""
    
    BASE_URL = "https://api.gios.gov.pl/pjp-api/v1/rest"
    
    # Rate limits from GIOŚ API documentation
    ARCHIVAL_MIN_INTERVAL = 30.0  # 2 requests per minute = 30s between requests
    MAX_PAGE_SIZE = 500  # Maximum allowed by GIOŚ API
    
    def __init__(self, max_retries: int = 5, timeout: int = 60):
        self.max_retries = max_retries
        self.timeout = timeout
        self._last_archival_request_time = 0.0
    
    async def _make_request(
        self, 
        url: str, 
        params: Optional[Dict[str, Any]] = None,
        is_archival: bool = False
    ) -> Dict[str, Any]:
        """Make HTTP request with improved retry logic based on GIOŚ API docs.
        
        Args:
            url: API endpoint URL
            params: Query parameters
            is_archival: True for archival data endpoints (stricter rate limits)
        """
        # Different retry strategies for different endpoints
        base_delay = 30.0 if is_archival else 2.0
        max_retries = self.max_retries if is_archival else 3
        
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(url, params=params)
                    
                    # Handle rate limit (429)
                    if response.status_code == 429:
                        wait_time = 60.0  # GIOŚ archival limit: 2/min
                        print(f"[GIOŚ] Rate limit (429), waiting {wait_time}s before retry...")
                        await asyncio.sleep(wait_time)
                        continue
                    
                    # Handle server errors with exponential backoff
                    if response.status_code in (500, 502, 503):
                        wait_time = min(base_delay * (2 ** attempt), 120.0)  # Cap at 2 min
                        print(f"[GIOŚ] Server error {response.status_code}, waiting {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})...")
                        await asyncio.sleep(wait_time)
                        continue
                    
                    # Handle timeout (504)
                    if response.status_code == 504:
                        wait_time = base_delay
                        print(f"[GIOŚ] Gateway timeout (504), waiting {wait_time:.1f}s before retry...")
                        await asyncio.sleep(wait_time)
                        continue
                    
                    response.raise_for_status()
                    return response.json()
                    
            except httpx.TimeoutException:
                wait_time = min(base_delay * (2 ** attempt), 60.0)
                print(f"[GIOŚ] Request timeout, waiting {wait_time:.1f}s (attempt {attempt + 1}/{max_retries})...")
                await asyncio.sleep(wait_time)
                
            except httpx.HTTPError as e:
                if attempt == max_retries - 1:
                    raise Exception(f"Failed to fetch data after {max_retries} attempts: {e}")
                wait_time = min(base_delay * (2 ** attempt), 60.0)
                await asyncio.sleep(wait_time)
        
        return {}
    
    async def _rate_limited_archival_request(
        self,
        url: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Make archival data request with rate limiting (2 req/min)."""
        # Enforce minimum interval between archival requests
        elapsed = time.time() - self._last_archival_request_time
        if elapsed < self.ARCHIVAL_MIN_INTERVAL:
            wait_time = self.ARCHIVAL_MIN_INTERVAL - elapsed
            await asyncio.sleep(wait_time)
        
        self._last_archival_request_time = time.time()
        return await self._make_request(url, params, is_archival=True)
    
    async def fetch_all_stations(self) -> List[Dict[str, Any]]:
        """Fetch all monitoring stations with pagination."""
        all_stations = []
        page = 0
        page_size = 100  # Stations endpoint has higher limit
        
        while True:
            url = f"{self.BASE_URL}/station/findAll"
            params = {"page": page, "size": page_size}
            
            try:
                data = await self._make_request(url, params)
                
                # Handle potential error responses
                if "error" in data:
                    break
                
                stations = data.get("Lista stacji pomiarowych", [])
                if not stations:
                    break
                
                all_stations.extend(stations)
                
                # Check if we've fetched all pages
                total_pages = data.get("totalPages", 1)
                page += 1
                if page >= total_pages:
                    break
                    
            except Exception as e:
                print(f"Error fetching stations page {page}: {e}")
                break
        
        return all_stations
    
    async def fetch_station_sensors(self, station_id: int) -> List[Dict[str, Any]]:
        """Fetch sensors for a specific station."""
        url = f"{self.BASE_URL}/station/sensors/{station_id}"
        
        try:
            data = await self._make_request(url)
            # API returns the list under this key (as of v1/rest)
            return (
                data.get("Lista stanowisk pomiarowych dla podanej stacji", [])
                or data.get("Lista stanowisk pomiarowych", [])
            )
        except Exception as e:
            print(f"Error fetching sensors for station {station_id}: {e}")
            return []
    
    async def fetch_sensor_data(
        self,
        sensor_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict[str, Any]]:
        """Fetch archival data for a sensor with rate limiting.

        Rate limit: 2 requests per minute for archival data.
        Max page size: 500 (enforced by GIOŚ API).
        Max date range per request: 366 days.
        """
        all_measurements: List[Dict[str, Any]] = []

        url = f"{self.BASE_URL}/archivalData/getDataBySensor/{sensor_id}"

        # Split into year-long chunks
        current_start = start_date
        while current_start < end_date:
            # Calculate chunk end date (max 365 days)
            chunk_end = min(current_start + timedelta(days=365), end_date)

            # Format dates for API
            date_from = current_start.strftime("%Y-%m-%d %H:%M")
            date_to = chunk_end.strftime("%Y-%m-%d %H:%M")

            # Pull all pages for this chunk
            page = 0

            while True:
                params = {
                    "dateFrom": date_from,
                    "dateTo": date_to,
                    "page": page,
                    "size": self.MAX_PAGE_SIZE,  # Use max allowed by API (500)
                }

                try:
                    # Use rate-limited request for archival data
                    data = await self._rate_limited_archival_request(url, params)
                    measurements = data.get("Lista archiwalnych wyników pomiarów", [])
                    all_measurements.extend(measurements)

                    total_pages = data.get("totalPages", 1)
                    page += 1
                    if page >= total_pages:
                        break

                except Exception as e:
                    print(
                        f"Error fetching data for sensor {sensor_id} (page {page}, {date_from} to {date_to}): {e}"
                    )
                    break

            # Move to next chunk (avoid overlapping boundary timestamps)
            current_start = chunk_end + timedelta(seconds=1)

        return all_measurements
    
    async def fetch_current_data(self, sensor_id: int) -> Dict[str, Any]:
        """Fetch current measurement data for a sensor."""
        url = f"{self.BASE_URL}/data/getData/{sensor_id}"
        
        try:
            return await self._make_request(url)
        except Exception as e:
            print(f"Error fetching current data for sensor {sensor_id}: {e}")
            return {}
