"""Background refresh jobs.

Goals:
- User request path must be cache-only (no calls to the upstream GIOŚ API).
- A background hourly job pulls incremental updates with an overlap window.
- A weekly sweep re-fetches the last N days to capture late reports/corrections.

The jobs write into SQLite via CacheManager.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from dateutil.relativedelta import relativedelta

from .cache_manager import CacheManager
from .data_fetcher import GiosDataFetcher
from .data_processor import DataProcessor, POLLUTANTS
from .settings import AirQualitySettings


JOB_HOURLY_REFRESH = "hourly_refresh"
JOB_WEEKLY_SWEEP = "weekly_sweep"


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _now() -> datetime:
    # Keep it naive; the current DB stores timestamps like "YYYY-MM-DD HH:MM:SS".
    return datetime.utcnow()


class RefreshCoordinator:
    def __init__(
        self,
        *,
        cache: CacheManager,
        fetcher: GiosDataFetcher,
        processor: DataProcessor,
        settings: AirQualitySettings,
    ):
        self.cache = cache
        self.fetcher = fetcher
        self.processor = processor
        self.settings = settings

        # Lazy-initialized to avoid event loop issues
        self._run_lock: Optional[asyncio.Lock] = None
        self._sem: Optional[asyncio.Semaphore] = None
        self._stop: Optional[asyncio.Event] = None
        self._tasks: List[asyncio.Task] = []

    def _get_lock(self) -> asyncio.Lock:
        """Get or create lock in current event loop."""
        if self._run_lock is None:
            self._run_lock = asyncio.Lock()
        return self._run_lock

    def _get_semaphore(self) -> asyncio.Semaphore:
        """Get or create semaphore in current event loop."""
        if self._sem is None:
            self._sem = asyncio.Semaphore(max(1, self.settings.refresh_concurrency))
        return self._sem

    def _get_stop_event(self) -> asyncio.Event:
        """Get or create stop event in current event loop."""
        if self._stop is None:
            self._stop = asyncio.Event()
        return self._stop

    def start(self):
        # Start periodic loops.
        if self._tasks:
            return
        self._tasks.append(asyncio.create_task(self._hourly_loop(), name="airquality-hourly-refresh"))
        self._tasks.append(asyncio.create_task(self._weekly_loop(), name="airquality-weekly-sweep"))

    async def stop(self):
        self._get_stop_event().set()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def run_hourly_once(self) -> Dict[str, Any]:
        return await self._run_job(kind=JOB_HOURLY_REFRESH)

    async def run_weekly_once(self) -> Dict[str, Any]:
        return await self._run_job(kind=JOB_WEEKLY_SWEEP)

    async def _hourly_loop(self):
        interval = max(1, int(self.settings.refresh_interval_seconds))
        stop_event = self._get_stop_event()

        # Run immediately on startup.
        while not stop_event.is_set():
            started_at = _now()
            try:
                await self.run_hourly_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # Keep the loop alive.
                print(f"[refresh] hourly job error: {e}")

            elapsed = (_now() - started_at).total_seconds()
            sleep_s = max(0, interval - elapsed)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=sleep_s)
            except asyncio.TimeoutError:
                continue

    async def _weekly_loop(self):
        # Check periodically whether a weekly run is due.
        check_every_s = 3600
        stop_event = self._get_stop_event()
        while not stop_event.is_set():
            try:
                await self._maybe_run_weekly()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[refresh] weekly loop error: {e}")

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=check_every_s)
            except asyncio.TimeoutError:
                continue

    async def _maybe_run_weekly(self):
        interval = max(1, int(self.settings.weekly_sweep_interval_seconds))
        now = _now()

        state = await self.cache.get_job_state(JOB_WEEKLY_SWEEP)
        last_success = _parse_dt(state.get("last_success_at")) if state else None

        if last_success and (now - last_success).total_seconds() < interval:
            return

        await self.run_weekly_once()

    async def _run_job(self, *, kind: str) -> Dict[str, Any]:
        """Run one refresh job, serialised across job kinds."""
        async with self._get_lock():
            started_at = _now()
            job_error: Optional[str] = None
            stats: Dict[str, Any] = {}

            try:
                if kind == JOB_HOURLY_REFRESH:
                    stats = await self._run_hourly_refresh(started_at)
                elif kind == JOB_WEEKLY_SWEEP:
                    stats = await self._run_weekly_sweep(started_at)
                else:
                    raise ValueError(f"Unknown job kind: {kind}")

                finished_at = _now()
                await self.cache.upsert_job_state(
                    job_name=kind,
                    last_run_at=started_at,
                    last_success_at=finished_at,
                    last_error=None,
                )
                return {"ok": True, "job": kind, "started_at": started_at, "finished_at": finished_at, **stats}

            except Exception as e:
                job_error = str(e)
                await self.cache.upsert_job_state(
                    job_name=kind,
                    last_run_at=started_at,
                    last_success_at=None,
                    last_error=job_error[:1000],
                )
                raise

    async def _get_target_stations(self) -> List[Dict[str, Any]]:
        all_stations = await self.cache.get_stations()

        by_id: Dict[int, Dict[str, Any]] = {}
        for city in self.settings.enabled_cities:
            for station in self.processor.filter_stations_by_city(all_stations, city):
                station_id = station.get("Identyfikator stacji")
                if station_id is None:
                    continue
                by_id[int(station_id)] = station

        return list(by_id.values())

    async def _get_station_sensors(self, station_id: int, *, force_refresh: bool) -> List[Dict[str, Any]]:
        sensors = []
        if not force_refresh:
            sensors = await self.cache.get_sensors(station_id)

        if sensors:
            return sensors

        # Not cached (or forced): fetch from upstream.
        sensors = await self.fetcher.fetch_station_sensors(station_id)
        if sensors:
            await self.cache.cache_sensors(station_id, sensors)
        return sensors

    async def _run_hourly_refresh(self, started_at: datetime) -> Dict[str, Any]:
        now = _now()
        overlap = timedelta(seconds=int(self.settings.refresh_overlap_seconds))
        history_years = int(self.settings.history_years)

        stations = await self._get_target_stations()

        # Collect refresh targets.
        targets: List[Tuple[int, int, str]] = []  # (station_id, sensor_id, pollutant_code)
        for station in stations:
            station_id = int(station["Identyfikator stacji"])
            sensors = await self._get_station_sensors(station_id, force_refresh=False)
            for sensor in sensors:
                pollutant_code = sensor.get("Wskaźnik - wzór")
                if pollutant_code not in POLLUTANTS:
                    continue
                sensor_id = sensor.get("Identyfikator stanowiska")
                if sensor_id is None:
                    continue
                targets.append((station_id, int(sensor_id), str(pollutant_code)))

        results = await self._refresh_targets(
            now=now,
            targets=targets,
            window="hourly",
            overlap=overlap,
            history_years=history_years,
            lookback=None,
        )

        return {"stations": len(stations), "sensors": len(targets), **results}

    async def _run_weekly_sweep(self, started_at: datetime) -> Dict[str, Any]:
        now = _now()
        lookback = timedelta(seconds=int(self.settings.weekly_sweep_lookback_seconds))

        stations = await self._get_target_stations()

        targets: List[Tuple[int, int, str]] = []
        for station in stations:
            station_id = int(station["Identyfikator stacji"])
            # Weekly sweep also refreshes sensors list to pick up changes.
            sensors = await self._get_station_sensors(station_id, force_refresh=True)
            for sensor in sensors:
                pollutant_code = sensor.get("Wskaźnik - wzór")
                if pollutant_code not in POLLUTANTS:
                    continue
                sensor_id = sensor.get("Identyfikator stanowiska")
                if sensor_id is None:
                    continue
                targets.append((station_id, int(sensor_id), str(pollutant_code)))

        results = await self._refresh_targets(
            now=now,
            targets=targets,
            window="weekly",
            overlap=None,
            history_years=None,
            lookback=lookback,
        )

        return {"stations": len(stations), "sensors": len(targets), **results}

    async def _refresh_targets(
        self,
        *,
        now: datetime,
        targets: List[Tuple[int, int, str]],
        window: str,
        overlap: Optional[timedelta],
        history_years: Optional[int],
        lookback: Optional[timedelta],
    ) -> Dict[str, Any]:
        async def run_one(station_id: int, sensor_id: int, pollutant_code: str) -> Tuple[int, bool, Optional[str]]:
            """Return: (fetched_points, updated_ok, error_message)."""
            async with self._get_semaphore():
                attempt_at = _now()
                try:
                    from_dt: datetime
                    to_dt: datetime = now

                    if lookback is not None:
                        from_dt = now - lookback
                    else:
                        # Check both max and min dates to determine what to fetch
                        max_dt = await self.cache.get_max_measurement_date(sensor_id)
                        min_dt = await self.cache.get_min_measurement_date(sensor_id)
                        
                        history_start = now - relativedelta(years=history_years) if history_years else None
                        
                        if max_dt is None:
                            # No data at all - fetch full history
                            if history_start is None:
                                return (0, False, None)
                            from_dt = history_start
                            print(f"[backfill] Sensor {sensor_id} ({pollutant_code}): no data. Fetching from {from_dt}")
                        elif history_start and (min_dt is None or min_dt > history_start):
                            # Have data but not full history - fetch older data (backfill)
                            from_dt = history_start
                            to_dt = min_dt if min_dt else now
                            print(f"[backfill] Sensor {sensor_id} ({pollutant_code}): partial data (min={min_dt}). Fetching {from_dt} to {to_dt}")
                        else:
                            # Have full history - just fetch new data
                            from_dt = max_dt - (overlap or timedelta(0))

                    # Avoid inverted ranges.
                    if from_dt > to_dt:
                        from_dt = to_dt - (overlap or timedelta(seconds=0))

                    fetched = await self.fetcher.fetch_sensor_data(sensor_id, from_dt, to_dt)
                    if fetched:
                        await self.cache.cache_measurements(sensor_id, station_id, pollutant_code, fetched)
                        print(f"[backfill] Sensor {sensor_id} ({pollutant_code}): saved {len(fetched)} points.")

                    max_after = await self.cache.get_max_measurement_date(sensor_id)
                    await self.cache.upsert_sync_state(
                        sensor_id=sensor_id,
                        max_date=max_after,
                        last_success_at=_now(),
                        last_attempt_at=attempt_at,
                        last_error=None,
                    )

                    return (len(fetched) if fetched else 0, True, None)

                except Exception as e:
                    await self.cache.upsert_sync_state(
                        sensor_id=sensor_id,
                        max_date=None,
                        last_success_at=None,
                        last_attempt_at=_now(),
                        last_error=str(e)[:1000],
                    )
                    err = f"sensor {sensor_id} ({pollutant_code}) {window}: {e}"
                    return (0, False, err)

        tasks = [
            asyncio.create_task(run_one(station_id, sensor_id, pollutant_code))
            for station_id, sensor_id, pollutant_code in targets
        ]

        fetched_points = 0
        updated_sensors = 0
        errors: List[str] = []

        if tasks:
            results = await asyncio.gather(*tasks)
            for fetched_count, updated_ok, err in results:
                fetched_points += fetched_count
                if updated_ok:
                    updated_sensors += 1
                if err:
                    errors.append(err)

        return {
            "updated_sensors": updated_sensors,
            "fetched_points": fetched_points,
            "errors": errors[:20],  # cap payload
            "error_count": len(errors),
        }
