"""Data fetcher for GIOŚ Air Quality API."""
import httpx
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dateutil.relativedelta import relativedelta


class GiosDataFetcher:
    """Fetches air quality data from GIOŚ API."""
    
    BASE_URL = "https://api.gios.gov.pl/pjp-api/v1/rest"
    
    def __init__(self, max_retries: int = 3, timeout: int = 30):
        self.max_retries = max_retries
        self.timeout = timeout
    
    async def _make_request(
        self, 
        url: str, 
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Make HTTP request with retry logic."""
        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    return response.json()
            except httpx.HTTPError as e:
                if attempt == self.max_retries - 1:
                    raise Exception(f"Failed to fetch data after {self.max_retries} attempts: {e}")
                # Exponential backoff
                await asyncio.sleep(2 ** attempt)
        
        return {}
    
    async def fetch_all_stations(self) -> List[Dict[str, Any]]:
        """Fetch all monitoring stations with pagination."""
        all_stations = []
        page = 0
        page_size = 100  # Fetch larger pages
        
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
        """Fetch archival data for a sensor.

        Note: GIOŚ API has a limit of ~366 days per request.
        This method splits the date range into chunks if needed.

        Important: the endpoint is paginated (default page size is small), so we
        must request a sufficiently large `size` or iterate pages.
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
            page_size = 2000  # Reduced from 10000 to avoid GIOS API 500 errors

            while True:
                params = {
                    "dateFrom": date_from,
                    "dateTo": date_to,
                    "page": page,
                    "size": page_size,
                }

                try:
                    data = await self._make_request(url, params)
                    measurements = data.get("Lista archiwalnych wyników pomiarów", [])
                    all_measurements.extend(measurements)

                    total_pages = data.get("totalPages", 1)
                    page += 1
                    if page >= total_pages:
                        break

                    # Longer delay to avoid GIOS API rate limiting/overload
                    await asyncio.sleep(1.0)

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
