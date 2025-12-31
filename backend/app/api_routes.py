"""API routes for Air Quality application."""
import asyncio
from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
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

    # Precompute trends data for instant TrendsPage loading
    asyncio.create_task(_precompute_trends())

    # Start background refresh loops (hourly delta + weekly sweep)
    refresh_coordinator.start()


async def _precompute_trends():
    """Precompute trends for all pollutant/method/standard combinations.
    
    This runs in background at startup so TrendsPage loads instantly.
    """
    pollutants = ["PM10", "PM2.5"]
    methods = ["city_avg", "worst_station"]
    standards = ["who", "eu"]
    
    print("[precompute] Starting trends precomputation...")
    start_time = datetime.now()
    
    computed = 0
    for pollutant in pollutants:
        for method in methods:
            for standard in standards:
                try:
                    await ranking_service.compute_trends(
                        pollutant=pollutant,
                        method=method,
                        standard=standard,
                    )
                    computed += 1
                    print(f"[precompute] Computed: {pollutant}/{method}/{standard}")
                except Exception as e:
                    print(f"[precompute] Error computing {pollutant}/{method}/{standard}: {e}")
    
    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"[precompute] Finished {computed} trend combinations in {elapsed:.1f}s")


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


# ============================================================================
# Admin Endpoints
# ============================================================================

@router.post("/admin/full-refresh")
async def trigger_full_refresh():
    """Trigger one-time full 15-year backfill for all configured cities.
    
    This runs the hourly refresh job immediately (adds only missing data).
    The job runs in the background; use /api/refresh/status to monitor progress.
    """
    # Run in background task
    asyncio.create_task(_full_refresh_task())
    
    return {
        "status": "started",
        "message": "Full refresh started in background. Monitor with /api/refresh/status",
        "settings": {
            "history_years": settings.history_years,
            "enabled_cities": settings.enabled_cities,
        }
    }


async def _full_refresh_task():
    """Background task for full refresh."""
    import json
    import os
    from pathlib import Path
    
    print("[full-refresh] Starting one-time full refresh...")
    start_time = datetime.now()
    
    try:
        result = await refresh_coordinator.run_hourly_once()
        elapsed = (datetime.now() - start_time).total_seconds()
        
        # Prepare report
        report = {
            "started_at": start_time.isoformat(),
            "finished_at": datetime.now().isoformat(),
            "elapsed_seconds": round(elapsed, 1),
            "settings": {
                "history_years": settings.history_years,
                "enabled_cities": settings.enabled_cities,
            },
            "result": {
                "ok": result.get("ok"),
                "stations": result.get("stations"),
                "sensors": result.get("sensors"),
                "updated_sensors": result.get("updated_sensors"),
                "fetched_points": result.get("fetched_points"),
                "error_count": result.get("error_count"),
                "errors": result.get("errors", [])[:10],  # limit for readability
            }
        }
        
        # Save to file
        report_dir = Path(os.getenv("DATABASE_PATH", "data")).parent / "refresh_reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        report_file = report_dir / f"refresh_{start_time.strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(report_file, "w") as f:
            json.dump(report, f, indent=2, default=str)
        
        print(f"[full-refresh] Completed in {elapsed:.1f}s")
        print(f"[full-refresh] Stats: stations={result.get('stations')}, sensors={result.get('sensors')}, fetched_points={result.get('fetched_points')}, errors={result.get('error_count')}")
        print(f"[full-refresh] Report saved to: {report_file}")
        
    except Exception as e:
        print(f"[full-refresh] Error: {e}")


@router.get("/admin/refresh-reports")
async def get_refresh_reports():
    """List all refresh reports saved to disk."""
    import json
    import os
    from pathlib import Path
    
    report_dir = Path(os.getenv("DATABASE_PATH", "data")).parent / "refresh_reports"
    
    if not report_dir.exists():
        return {"reports": [], "message": "No reports directory found"}
    
    reports = []
    for f in sorted(report_dir.glob("refresh_*.json"), reverse=True)[:20]:  # Last 20 reports
        try:
            with open(f) as fp:
                data = json.load(fp)
                reports.append({
                    "filename": f.name,
                    "started_at": data.get("started_at"),
                    "elapsed_seconds": data.get("elapsed_seconds"),
                    "stations": data.get("result", {}).get("stations"),
                    "fetched_points": data.get("result", {}).get("fetched_points"),
                    "error_count": data.get("result", {}).get("error_count"),
                })
        except Exception:
            continue
    
    return {"reports": reports, "total": len(reports)}


@router.get("/admin/refresh-reports/{filename}")
async def get_refresh_report_detail(filename: str):
    """Get detailed refresh report by filename."""
    import json
    import os
    from pathlib import Path
    
    report_dir = Path(os.getenv("DATABASE_PATH", "data")).parent / "refresh_reports"
    report_file = report_dir / filename
    
    if not report_file.exists() or not filename.startswith("refresh_"):
        raise HTTPException(status_code=404, detail="Report not found")
    
    with open(report_file) as f:
        return json.load(f)


@router.get("/admin/completeness-report")
async def get_completeness_report(
    min_hourly: int = Query(18, description="Minimum hourly values for a day to be considered complete (default 18/24)"),
):
    """Generate data completeness report per station/year/pollutant.
    
    Returns completeness statistics showing how many days have sufficient
    hourly measurements (default: 18 out of 24 hours).
    """
    raw_stats = await cache.get_completeness_stats(min_hourly_per_day=min_hourly)
    
    # Group by city -> station -> year
    cities_map: Dict[str, Dict[int, Dict[str, Any]]] = {}
    
    for row in raw_stats:
        city = row["city_name"]
        station_id = row["station_id"]
        
        if city not in cities_map:
            cities_map[city] = {}
        
        if station_id not in cities_map[city]:
            cities_map[city][station_id] = {
                "station_id": station_id,
                "station_name": row["station_name"],
                "years": {}
            }
        
        year = row["year"]
        if year not in cities_map[city][station_id]["years"]:
            cities_map[city][station_id]["years"][year] = {
                "year": year,
                "pollutants": {}
            }
        
        cities_map[city][station_id]["years"][year]["pollutants"][row["pollutant_code"]] = {
            "complete_days": row["complete_days"],
            "total_days": row["total_days"],
            "completeness_pct": row["completeness_pct"],
            "total_hourly_values": row["total_hourly_values"],
        }
    
    # Convert to list format
    cities_list = []
    for city_name in sorted(cities_map.keys()):
        stations_list = []
        for station_id in sorted(cities_map[city_name].keys()):
            station_data = cities_map[city_name][station_id]
            years_list = []
            for year in sorted(station_data["years"].keys(), reverse=True):
                year_data = station_data["years"][year]
                pollutants = year_data["pollutants"]
                
                # Calculate overall completeness for this year (average across pollutants)
                if pollutants:
                    avg_pct = round(
                        sum(p["completeness_pct"] for p in pollutants.values()) / len(pollutants),
                        1
                    )
                else:
                    avg_pct = 0.0
                
                years_list.append({
                    "year": year,
                    "avg_completeness_pct": avg_pct,
                    "pollutants": pollutants,
                })
            
            stations_list.append({
                "station_id": station_id,
                "station_name": station_data["station_name"],
                "years": years_list,
            })
        
        cities_list.append({
            "city": city_name,
            "stations": stations_list,
        })
    
    return {
        "generated_at": datetime.now().isoformat(),
        "threshold": f"{min_hourly}/24 hourly values per day",
        "total_stations": sum(len(c["stations"]) for c in cities_list),
        "cities": cities_list,
    }

