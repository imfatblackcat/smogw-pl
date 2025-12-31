"""API routes for Air Quality application."""
import asyncio
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timedelta
from typing import List, Optional
from .data_fetcher import GiosDataFetcher
from .cache_manager import CacheManager
from .data_processor import DataProcessor, POLLUTANTS
from .models import CityInfo, PollutantInfo, DataPoint, DataResponse
from .settings import load_settings
from .refresh_jobs import RefreshCoordinator, JOB_HOURLY_REFRESH, JOB_WEEKLY_SWEEP
from .ranking_service import RankingService

router = APIRouter(prefix="/api")

# Initialize components
settings = load_settings()
fetcher = GiosDataFetcher()
cache = CacheManager()
processor = DataProcessor()
ranking_service = RankingService(cache=cache)

refresh_coordinator: RefreshCoordinator = RefreshCoordinator(
    cache=cache,
    fetcher=fetcher,
    processor=processor,
    settings=settings,
)


@router.on_event("startup")
async def startup_event():
    """Initialize cache and start background refresh jobs."""
    await cache.initialize()

    # Fetch and cache stations if not already cached
    cached_stations = await cache.get_stations()
    if not cached_stations:
        print("Fetching all stations from GIOŚ API...")
        stations = await fetcher.fetch_all_stations()
        await cache.cache_stations(stations)
        print(f"Cached {len(stations)} stations")

    # Start background refresh loops (hourly delta + weekly sweep)
    refresh_coordinator.start()


@router.on_event("shutdown")
async def shutdown_event():
    """Stop background refresh jobs."""
    await refresh_coordinator.stop()


@router.get("/cities")
async def get_cities():
    """Get list of major cities with their stations."""
    all_stations = await cache.get_stations()
    grouped = processor.group_stations_by_city(all_stations, cities=settings.enabled_cities)
    
    cities = []
    for city_name, stations in grouped.items():
        if stations:  # Only include cities with stations
            cities.append({
                "name": city_name,
                "station_count": len(stations),
                "stations": [
                    {
                        "id": s["Identyfikator stacji"],
                        "name": s["Nazwa stacji"],
                        "latitude": s.get("WGS84 φ N"),
                        "longitude": s.get("WGS84 λ E")
                    }
                    for s in stations
                ]
            })
    
    return {"cities": cities}


@router.get("/stations")
async def get_stations(city: str = Query(..., description="City name")):
    """Get stations for a specific city."""
    all_stations = await cache.get_stations()
    city_stations = processor.filter_stations_by_city(all_stations, city)
    
    return {
        "city": city,
        "stations": [
            {
                "id": s["Identyfikator stacji"],
                "name": s["Nazwa stacji"],
                "latitude": s.get("WGS84 φ N"),
                "longitude": s.get("WGS84 λ E"),
                "address": s.get("Ulica", "")
            }
            for s in city_stations
        ]
    }


@router.get("/pollutants")
async def get_pollutants():
    """Get list of available pollutants."""
    return {
        "pollutants": [
            {"code": code, **info}
            for code, info in POLLUTANTS.items()
        ]
    }


RANKING_POLLUTANTS = {"PM10", "PM2.5"}
RANKING_METHODS = {"city_avg", "worst_station", "any_station_exceed"}


@router.get("/ranking/years")
async def get_ranking_years(
    pollutant: str = Query(..., description="Pollutant code (PM10 or PM2.5)"),
):
    """Get years with available data for a pollutant (based on cached measurements)."""
    if pollutant not in RANKING_POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Invalid pollutant: {pollutant}")

    years = await cache.get_available_years_for_pollutant(pollutant)
    return {"pollutant": pollutant, "years": years}


@router.get("/ranking/trends")
async def get_ranking_trends(
    pollutant: str = Query(..., description="Pollutant code (PM10 or PM2.5)"),
    standard: str = Query("who", description="Standard: who | eu"),
    method: str = Query("city_avg", description="Method: city_avg | worst_station | any_station_exceed"),
):
    """Get multi-year city exceedance trends (cached annual stats)."""
    if pollutant not in RANKING_POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Invalid pollutant: {pollutant}")
    if method not in RANKING_METHODS:
        raise HTTPException(status_code=400, detail=f"Invalid method: {method}")
    if standard not in ("who", "eu"):
        raise HTTPException(status_code=400, detail="Invalid standard. Use 'who' or 'eu'")

    try:
        # compute_trends handles caching (reading fast for old years, computing for new)
        result = await ranking_service.compute_trends(
            pollutant=pollutant,
            method=method,  # type: ignore[arg-type]
            standard=standard,  # type: ignore[arg-type]
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/ranking")
async def get_ranking(
    year: int = Query(..., ge=1900, le=2100, description="Year (YYYY)"),
    pollutant: str = Query(..., description="Pollutant code (PM10 or PM2.5)"),
    method: str = Query("city_avg", description="Aggregation method: city_avg | worst_station | any_station_exceed"),
    force: bool = Query(False, description="Recompute even if a cached ranking exists"),
):
    """Get (or compute) a precomputed city ranking for the given year and pollutant."""
    if pollutant not in RANKING_POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Invalid pollutant: {pollutant}")
    if method not in RANKING_METHODS:
        raise HTTPException(status_code=400, detail=f"Invalid method: {method}")

    if not force:
        cached = await cache.get_city_ranking(year=year, pollutant_code=pollutant, method=method)
        if cached:
            return cached

    try:
        result = await ranking_service.compute_year_ranking(
            year=year,
            pollutant=pollutant,
            method=method,  # type: ignore[arg-type]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    payload = {
        "cities": result.cities,
        "total_cities": len(result.cities),
    }

    await cache.upsert_city_ranking(
        year=year,
        pollutant_code=pollutant,
        method=method,
        threshold_value=result.threshold_value,
        allowed_exceedances_per_year=result.allowed_exceedances_per_year,
        days_rule=result.days_rule,
        payload=payload,
    )

    # Return what we stored (single source of truth).
    stored = await cache.get_city_ranking(year=year, pollutant_code=pollutant, method=method)
    return stored or {
        "year": year,
        "pollutant": pollutant,
        "method": method,
        "threshold_value": result.threshold_value,
        "allowed_exceedances_per_year": result.allowed_exceedances_per_year,
        "days_rule": result.days_rule,
        "computed_at": result.computed_at,
        **payload,
    }


@router.get("/refresh/status")
async def get_refresh_status():
    """Get background refresh job status."""
    hourly = await cache.get_job_state(JOB_HOURLY_REFRESH)
    weekly = await cache.get_job_state(JOB_WEEKLY_SWEEP)

    return {
        "settings": {
            "enabled_cities": settings.enabled_cities,
            "refresh_interval_seconds": settings.refresh_interval_seconds,
            "refresh_overlap_seconds": settings.refresh_overlap_seconds,
            "weekly_sweep_interval_seconds": settings.weekly_sweep_interval_seconds,
            "weekly_sweep_lookback_seconds": settings.weekly_sweep_lookback_seconds,
            "history_years": settings.history_years,
            "refresh_concurrency": settings.refresh_concurrency,
        },
        "jobs": {
            JOB_HOURLY_REFRESH: hourly,
            JOB_WEEKLY_SWEEP: weekly,
        },
    }


@router.post("/refresh/run")
async def trigger_hourly_refresh():
    """Trigger an hourly refresh run (runs synchronously)."""
    try:
        result = await refresh_coordinator.run_hourly_once()
        return {"ok": True, "job": JOB_HOURLY_REFRESH, **result}
    except Exception as e:
        return {"ok": False, "job": JOB_HOURLY_REFRESH, "error": str(e)}


@router.post("/refresh/sweep")
async def trigger_weekly_sweep():
    """Trigger a weekly sweep run (runs synchronously)."""
    try:
        result = await refresh_coordinator.run_weekly_once()
        return {"ok": True, "job": JOB_WEEKLY_SWEEP, **result}
    except Exception as e:
        return {"ok": False, "job": JOB_WEEKLY_SWEEP, "error": str(e)}


@router.get("/data")
async def get_data(
    cities: List[str] = Query(..., description="List of cities"),
    pollutant: str = Query(..., description="Pollutant code (e.g., PM10)"),
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    station_ids: Optional[List[int]] = Query(None, description="Specific station IDs"),
    aggregation: str = Query("daily", description="Aggregation type")
):
    """Get air quality data for specified parameters."""
    
    # Validate pollutant
    if pollutant not in POLLUTANTS:
        raise HTTPException(status_code=400, detail=f"Invalid pollutant: {pollutant}")
    
    # Parse dates
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    # Interpret end_date as inclusive (so a single-day range works as expected).
    end = end + timedelta(days=1) - timedelta(seconds=1)
    
    # Get all stations
    all_stations = await cache.get_stations()
    
    # Filter stations by cities or specific IDs
    if station_ids:
        target_stations = [s for s in all_stations if s["Identyfikator stacji"] in station_ids]
    else:
        target_stations = []
        for city in cities:
            target_stations.extend(processor.filter_stations_by_city(all_stations, city))
    
    if not target_stations:
        raise HTTPException(status_code=404, detail="No stations found for specified parameters")
    
    # Fetch data for each station
    all_data_points = []
    
    for station in target_stations:
        station_id = station["Identyfikator stacji"]
        station_name = station["Nazwa stacji"]
        city_name = station["Nazwa miasta"]
        
        # Cache-only: do NOT call upstream API in the request path.
        sensors = await cache.get_sensors(station_id)
        if not sensors:
            continue
        
        # Find sensor for our pollutant
        matching_sensor = None
        for sensor in sensors:
            sensor_code = sensor.get("Wskaźnik - wzór", "")
            if sensor_code == pollutant:
                matching_sensor = sensor
                break
        
        if not matching_sensor:
            continue
        
        sensor_id = matching_sensor["Identyfikator stanowiska"]
        
        # Cache-only: read measurements from SQLite; background jobs populate it.
        measurements = await cache.get_measurements_by_sensor(sensor_id, start, end)
        
        # Aggregate if needed
        if aggregation != "hourly":
            measurements = processor.aggregate_measurements(measurements, aggregation)
        
        # Convert to data points
        for m in measurements:
            timestamp = m.get("Data")
            value = m.get("Wartość")
            
            if timestamp and value is not None:
                all_data_points.append({
                    "timestamp": timestamp,
                    "value": value,
                    "city": city_name,
                    "station_id": station_id,
                    "station_name": station_name
                })
    
    # If user didn't specify stations, calculate city averages
    if not station_ids and len(cities) > 0:
        # Group by city and timestamp
        by_city = {}
        for dp in all_data_points:
            city = dp["city"]
            if city not in by_city:
                by_city[city] = {}
            
            timestamp = dp["timestamp"]
            if timestamp not in by_city[city]:
                by_city[city][timestamp] = []
            by_city[city][timestamp].append(dp["value"])
        
        # Calculate averages
        averaged_data = []
        for city, timestamps in by_city.items():
            for timestamp, values in timestamps.items():
                if values:
                    avg_value = round(sum(values) / len(values), 2)
                    averaged_data.append({
                        "timestamp": timestamp,
                        "value": avg_value,
                        "city": city,
                        "station_id": None,
                        "station_name": f"{city} (średnia)"
                    })
        
        all_data_points = averaged_data
    
    return {
        "data": sorted(all_data_points, key=lambda x: x["timestamp"]),
        "pollutant": {
            "code": pollutant,
            **POLLUTANTS[pollutant]
        },
        "date_range": {
            "start": start_date,
            "end": end_date
        },
        "total_points": len(all_data_points)
    }
