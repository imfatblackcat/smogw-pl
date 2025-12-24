"""Cache manager for air quality data using SQLite."""
import aiosqlite
import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


class CacheManager:
    """Manages caching of air quality data in SQLite."""

    def __init__(self, db_path: Optional[Union[str, Path]] = None):
        # Make the default path independent from the current working directory.
        backend_dir = Path(__file__).resolve().parents[1]  # .../backend
        default_db_path = backend_dir / "data" / "cache.db"

        # Backwards-compat: older versions used a relative path "backend/data/cache.db".
        # When running from inside the backend directory this created: backend/backend/data/cache.db
        legacy_db_path = backend_dir / "backend" / "data" / "cache.db"

        if db_path is None:
            if not default_db_path.exists() and legacy_db_path.exists():
                default_db_path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    legacy_db_path.replace(default_db_path)
                except OSError:
                    # Fallback (e.g. cross-device): copy the legacy DB.
                    shutil.copy2(legacy_db_path, default_db_path)
            db_path = default_db_path

        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        try:
            self.busy_timeout_ms = int(os.getenv("AIRQUALITY_SQLITE_BUSY_TIMEOUT_MS", "5000"))
        except ValueError:
            self.busy_timeout_ms = 5000

    async def _configure_connection(self, db: aiosqlite.Connection):
        """Apply connection-level SQLite settings."""
        await db.execute(f"PRAGMA busy_timeout = {self.busy_timeout_ms}")
        await db.execute("PRAGMA foreign_keys = ON")

    async def initialize(self):
        """Initialize database schema."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)

            # DB-wide pragmas (persisted in the database)
            await db.execute("PRAGMA journal_mode = WAL")
            await db.execute("PRAGMA synchronous = NORMAL")

            # Stations table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS stations (
                    id INTEGER PRIMARY KEY,
                    code TEXT,
                    name TEXT,
                    latitude TEXT,
                    longitude TEXT,
                    city_id INTEGER,
                    city_name TEXT,
                    commune TEXT,
                    district TEXT,
                    voivodeship TEXT,
                    street TEXT,
                    data JSON,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Sensors table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sensors (
                    id INTEGER PRIMARY KEY,
                    station_id INTEGER,
                    pollutant_name TEXT,
                    pollutant_code TEXT,
                    pollutant_id INTEGER,
                    data JSON,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (station_id) REFERENCES stations (id)
                )
            """)
            
            # Measurements table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS measurements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sensor_id INTEGER,
                    station_id INTEGER,
                    pollutant_code TEXT,
                    date TIMESTAMP,
                    value REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (sensor_id) REFERENCES sensors (id),
                    FOREIGN KEY (station_id) REFERENCES stations (id)
                )
            """)

            # Per-sensor sync state for incremental refresh jobs
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sync_state (
                    sensor_id INTEGER PRIMARY KEY,
                    max_date TIMESTAMP,
                    last_success_at TIMESTAMP,
                    last_attempt_at TIMESTAMP,
                    last_error TEXT
                )
            """)

            # Job-level state (hourly refresh / weekly sweep)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS job_state (
                    job_name TEXT PRIMARY KEY,
                    last_run_at TIMESTAMP,
                    last_success_at TIMESTAMP,
                    last_error TEXT
                )
            """)

            # City rankings cache (precomputed)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS city_rankings (
                    year INTEGER NOT NULL,
                    pollutant_code TEXT NOT NULL,
                    method TEXT NOT NULL,
                    threshold_value REAL NOT NULL,
                    allowed_exceedances_per_year INTEGER NOT NULL,
                    days_rule TEXT NOT NULL,
                    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (year, pollutant_code, method)
                )
            """)
            
            # Indexes for faster queries
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_measurements_sensor_date 
                ON measurements(sensor_id, date)
            """)
            
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_measurements_station_pollutant_date 
                ON measurements(station_id, pollutant_code, date)
            """)
            
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_stations_city 
                ON stations(city_name)
            """)

            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_city_rankings_pollutant_year
                ON city_rankings(pollutant_code, year)
            """)

            # Prevent duplicates (e.g. when the same period is fetched multiple times).
            # Keep the newest row per (sensor_id, date) and enforce uniqueness.
            cursor = await db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
                ("idx_measurements_unique_sensor_date",),
            )
            unique_idx_exists = await cursor.fetchone()

            if not unique_idx_exists:
                await db.execute("""
                    DELETE FROM measurements
                    WHERE id NOT IN (
                        SELECT MAX(id) FROM measurements GROUP BY sensor_id, date
                    )
                """)
                await db.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_measurements_unique_sensor_date
                    ON measurements(sensor_id, date)
                """)
            
            await db.commit()

    async def cache_stations(self, stations: List[Dict[str, Any]]):
        """Cache list of stations."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            for station in stations:
                await db.execute("""
                    INSERT OR REPLACE INTO stations 
                    (id, code, name, latitude, longitude, city_id, city_name, 
                     commune, district, voivodeship, street, data, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    station.get("Identyfikator stacji"),
                    station.get("Kod stacji"),
                    station.get("Nazwa stacji"),
                    station.get("WGS84 φ N"),
                    station.get("WGS84 λ E"),
                    station.get("Identyfikator miasta"),
                    station.get("Nazwa miasta"),
                    station.get("Gmina"),
                    station.get("Powiat"),
                    station.get("Województwo"),
                    station.get("Ulica"),
                    json.dumps(station)
                ))
            await db.commit()

    async def get_stations(self, city_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get cached stations, optionally filtered by city."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            if city_name:
                # Exact match to avoid collisions like Szczecin/Szczecinek, Opole/Wilczopole, etc.
                query = "SELECT data FROM stations WHERE city_name = ?"
                cursor = await db.execute(query, (city_name,))
            else:
                query = "SELECT data FROM stations"
                cursor = await db.execute(query)
            
            rows = await cursor.fetchall()
            return [json.loads(row[0]) for row in rows]

    async def cache_sensors(self, station_id: int, sensors: List[Dict[str, Any]]):
        """Cache sensors for a station."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            for sensor in sensors:
                await db.execute("""
                    INSERT OR REPLACE INTO sensors 
                    (id, station_id, pollutant_name, pollutant_code, pollutant_id, data, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """, (
                    sensor.get("Identyfikator stanowiska"),
                    station_id,
                    sensor.get("Wskaźnik"),
                    sensor.get("Wskaźnik - wzór"),
                    sensor.get("Identyfikator wskaźnika"),
                    json.dumps(sensor)
                ))
            await db.commit()

    async def get_sensors(self, station_id: int) -> List[Dict[str, Any]]:
        """Get cached sensors for a station."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                "SELECT data FROM sensors WHERE station_id = ?",
                (station_id,)
            )
            rows = await cursor.fetchall()
            return [json.loads(row[0]) for row in rows]

    async def cache_measurements(
        self,
        sensor_id: int,
        station_id: int,
        pollutant_code: str,
        measurements: List[Dict[str, Any]]
    ):
        """Cache measurements for a sensor."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)

            rows = []
            for measurement in measurements:
                date_str = measurement.get("Data")
                if not date_str:
                    continue

                # Parse date - handle both formats
                try:
                    if isinstance(date_str, str):
                        date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                    else:
                        date = date_str
                except Exception:
                    continue

                value = measurement.get("Wartość")
                rows.append((sensor_id, station_id, pollutant_code, date, value))

            if rows:
                await db.executemany(
                    """
                    INSERT OR REPLACE INTO measurements
                    (sensor_id, station_id, pollutant_code, date, value)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    rows,
                )

            await db.commit()

    async def get_measurements(
        self,
        station_id: int,
        pollutant_code: str,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict[str, Any]]:
        """Get cached measurements for a station and pollutant."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute("""
                SELECT date, value FROM measurements
                WHERE station_id = ? AND pollutant_code = ?
                AND date BETWEEN ? AND ?
                ORDER BY date
            """, (station_id, pollutant_code, start_date, end_date))
            
            rows = await cursor.fetchall()
            return [{"Data": row[0], "Wartość": row[1]} for row in rows]

    async def get_measurements_by_sensor(
        self,
        sensor_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict[str, Any]]:
        """Get cached measurements for a specific sensor."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute("""
                SELECT date, value FROM measurements
                WHERE sensor_id = ?
                AND date BETWEEN ? AND ?
                ORDER BY date
            """, (sensor_id, start_date, end_date))

            rows = await cursor.fetchall()
            return [{"Data": row[0], "Wartość": row[1]} for row in rows]

    async def has_measurements_for_period(
        self,
        sensor_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> bool:
        """Check if we have measurements for a given period."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute("""
                SELECT COUNT(*) FROM measurements
                WHERE sensor_id = ? AND date BETWEEN ? AND ?
            """, (sensor_id, start_date, end_date))
            
            row = await cursor.fetchone()
            return row[0] > 0

    async def get_max_measurement_date(self, sensor_id: int) -> Optional[datetime]:
        """Return the latest measurement timestamp we have for a sensor."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                "SELECT MAX(date) FROM measurements WHERE sensor_id = ?",
                (sensor_id,),
            )
            row = await cursor.fetchone()
            if not row or row[0] is None:
                return None
            value = row[0]
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                try:
                    return datetime.fromisoformat(value)
                except ValueError:
                    return None
            return None

    async def get_min_measurement_date(self, sensor_id: int) -> Optional[datetime]:
        """Return the earliest measurement timestamp we have for a sensor."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                "SELECT MIN(date) FROM measurements WHERE sensor_id = ?",
                (sensor_id,),
            )
            row = await cursor.fetchone()
            if not row or row[0] is None:
                return None
            value = row[0]
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                try:
                    return datetime.fromisoformat(value)
                except ValueError:
                    return None
            return None

    async def get_sync_state(self, sensor_id: int) -> Optional[Dict[str, Any]]:
        """Get sync metadata for a sensor."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                "SELECT max_date, last_success_at, last_attempt_at, last_error FROM sync_state WHERE sensor_id = ?",
                (sensor_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return {
                "max_date": row[0],
                "last_success_at": row[1],
                "last_attempt_at": row[2],
                "last_error": row[3],
            }

    async def upsert_sync_state(
        self,
        *,
        sensor_id: int,
        max_date: Optional[datetime],
        last_success_at: Optional[datetime],
        last_attempt_at: Optional[datetime],
        last_error: Optional[str],
    ):
        """Insert/update sync state for a sensor."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            await db.execute(
                """
                INSERT INTO sync_state (sensor_id, max_date, last_success_at, last_attempt_at, last_error)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(sensor_id) DO UPDATE SET
                    max_date = COALESCE(excluded.max_date, sync_state.max_date),
                    last_success_at = COALESCE(excluded.last_success_at, sync_state.last_success_at),
                    last_attempt_at = excluded.last_attempt_at,
                    last_error = excluded.last_error
                """,
                (sensor_id, max_date, last_success_at, last_attempt_at, last_error),
            )
            await db.commit()

    async def get_job_state(self, job_name: str) -> Optional[Dict[str, Any]]:
        """Get job-level last run/success state."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                "SELECT last_run_at, last_success_at, last_error FROM job_state WHERE job_name = ?",
                (job_name,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return {"last_run_at": row[0], "last_success_at": row[1], "last_error": row[2]}

    async def upsert_job_state(
        self,
        *,
        job_name: str,
        last_run_at: datetime,
        last_success_at: Optional[datetime],
        last_error: Optional[str],
    ):
        """Insert/update job-level state."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            await db.execute(
                """
                INSERT INTO job_state (job_name, last_run_at, last_success_at, last_error)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(job_name) DO UPDATE SET
                    last_run_at = excluded.last_run_at,
                    last_success_at = COALESCE(excluded.last_success_at, job_state.last_success_at),
                    last_error = excluded.last_error
                """,
                (job_name, last_run_at, last_success_at, last_error),
            )
            await db.commit()

    async def get_available_years_for_pollutant(self, pollutant_code: str) -> List[int]:
        """Return years for which we have at least one non-null measurement for the pollutant."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                """
                SELECT DISTINCT strftime('%Y', date) AS year
                FROM measurements
                WHERE pollutant_code = ?
                  AND value IS NOT NULL
                  AND date IS NOT NULL
                ORDER BY year DESC
                """,
                (pollutant_code,),
            )
            rows = await cursor.fetchall()
            return [int(r[0]) for r in rows if r and r[0]]

    async def get_city_ranking(
        self,
        *,
        year: int,
        pollutant_code: str,
        method: str,
    ) -> Optional[Dict[str, Any]]:
        """Return cached city ranking payload (or None if not present)."""
        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            cursor = await db.execute(
                """
                SELECT threshold_value,
                       allowed_exceedances_per_year,
                       days_rule,
                       computed_at,
                       payload_json
                FROM city_rankings
                WHERE year = ? AND pollutant_code = ? AND method = ?
                """,
                (year, pollutant_code, method),
            )
            row = await cursor.fetchone()
            if not row:
                return None

            threshold_value, allowed_exceedances, days_rule, computed_at, payload_json = row
            payload = json.loads(payload_json)
            return {
                "year": year,
                "pollutant": pollutant_code,
                "method": method,
                "threshold_value": threshold_value,
                "allowed_exceedances_per_year": allowed_exceedances,
                "days_rule": days_rule,
                "computed_at": computed_at,
                **payload,
            }

    async def upsert_city_ranking(
        self,
        *,
        year: int,
        pollutant_code: str,
        method: str,
        threshold_value: float,
        allowed_exceedances_per_year: int,
        days_rule: str,
        payload: Dict[str, Any],
    ):
        """Insert/update cached ranking payload."""
        computed_at = datetime.utcnow().isoformat()
        payload_json = json.dumps(payload, ensure_ascii=False)

        async with aiosqlite.connect(self.db_path) as db:
            await self._configure_connection(db)
            await db.execute(
                """
                INSERT INTO city_rankings (
                    year,
                    pollutant_code,
                    method,
                    threshold_value,
                    allowed_exceedances_per_year,
                    days_rule,
                    computed_at,
                    payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(year, pollutant_code, method) DO UPDATE SET
                    threshold_value = excluded.threshold_value,
                    allowed_exceedances_per_year = excluded.allowed_exceedances_per_year,
                    days_rule = excluded.days_rule,
                    computed_at = excluded.computed_at,
                    payload_json = excluded.payload_json
                """,
                (
                    year,
                    pollutant_code,
                    method,
                    threshold_value,
                    allowed_exceedances_per_year,
                    days_rule,
                    computed_at,
                    payload_json,
                ),
            )
            await db.commit()
