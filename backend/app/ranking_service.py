"""City ranking computation (days exceeding EU daily limit values).

This module computes rankings from the local SQLite cache only.

Norms:
- EU Directive (EU) 2024/2881, Annex I, Table 1 (to be met by 1 Jan 2030).
  - PM10 (1 day): 45 μg/m³, allowed exceedances: 18 days/year
  - PM2.5 (1 day): 25 μg/m³, allowed exceedances: 18 days/year

Important:
- A station-day is considered valid if it has at least 18 non-null hourly values (75% of a day).
- City aggregation method is selectable (avg / worst station / any station exceed).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Literal, Tuple

import aiosqlite

from .cache_manager import CacheManager


RankingMethod = Literal["city_avg", "worst_station", "any_station_exceed"]
RankingStandard = Literal["eu", "who"]


@dataclass(frozen=True)
class EUDailyLimit:
    threshold_value: float
    allowed_exceedances_per_year: int


EU_2030_DAILY_LIMITS: Dict[str, EUDailyLimit] = {
    "PM10": EUDailyLimit(threshold_value=45.0, allowed_exceedances_per_year=18),
    "PM2.5": EUDailyLimit(threshold_value=25.0, allowed_exceedances_per_year=18),
}

WHO_DAILY_LIMITS: Dict[str, float] = {
    "PM10": 45.0,
    "PM2.5": 15.0,
}

MIN_HOURLY_VALUES_PER_DAY = 18


def _city_agg_expr(method: RankingMethod) -> str:
    if method == "city_avg":
        return "AVG(sd.station_day_avg)"
    if method in ("worst_station", "any_station_exceed"):
        # any_station_exceed is equivalent to worst_station for exceedance counting.
        return "MAX(sd.station_day_avg)"
    raise ValueError(f"Unknown method: {method}")


@dataclass(frozen=True)
class RankingResult:
    year: int
    pollutant: str
    method: RankingMethod
    threshold_value: float
    allowed_exceedances_per_year: int
    days_rule: str
    computed_at: str
    cities: List[Dict[str, Any]]


@dataclass(frozen=True)
class RankingTrendResult:
    pollutant: str
    method: RankingMethod
    standard: RankingStandard
    threshold_value: float
    years: List[int]
    cities: List[str]
    points: List[Dict[str, Any]]  # format: {year: {CityName: count, ...}}


class RankingService:
    def __init__(self, *, cache: CacheManager):
        self.cache = cache

    async def compute_year_ranking(
        self,
        *,
        year: int,
        pollutant: str,
        method: RankingMethod,
    ) -> RankingResult:
        if pollutant not in EU_2030_DAILY_LIMITS:
            raise ValueError(f"Unsupported pollutant: {pollutant}")

        limits = EU_2030_DAILY_LIMITS[pollutant]
        threshold_value = limits.threshold_value
        allowed_exceedances_per_year = limits.allowed_exceedances_per_year

        # Use inclusive-exclusive range [start, end)
        start = f"{year:04d}-01-01 00:00:00"
        end = f"{year + 1:04d}-01-01 00:00:00"

        days_rule = f"station_day_valid_if_hourly_values>={MIN_HOURLY_VALUES_PER_DAY}"
        computed_at = datetime.utcnow().isoformat()

        agg_expr = _city_agg_expr(method)

        query = f"""
        WITH station_daily AS (
            SELECT
                m.station_id AS station_id,
                date(m.date) AS day,
                AVG(m.value) AS station_day_avg,
                COUNT(m.value) AS station_day_count
            FROM measurements m
            WHERE m.pollutant_code = ?
              AND m.date >= ? AND m.date < ?
              AND m.value IS NOT NULL
            GROUP BY m.station_id, day
            HAVING station_day_count >= ?
        ),
        city_daily AS (
            SELECT
                s.city_name AS city,
                sd.day AS day,
                {agg_expr} AS city_day_value,
                COUNT(*) AS stations_with_data
            FROM station_daily sd
            JOIN stations s ON s.id = sd.station_id
            WHERE s.city_name IS NOT NULL AND s.city_name != ''
            GROUP BY s.city_name, sd.day
        ),
        city_stats AS (
            SELECT
                cd.city AS city,
                SUM(CASE WHEN cd.city_day_value > ? THEN 1 ELSE 0 END) AS exceedance_days,
                COUNT(*) AS days_with_data,
                ROUND(100.0 * SUM(CASE WHEN cd.city_day_value > ? THEN 1 ELSE 0 END) / COUNT(*), 2) AS exceedance_pct,
                ROUND(AVG(cd.city_day_value), 2) AS avg_city_day_value,
                ROUND(MAX(cd.city_day_value), 2) AS max_city_day_value,
                ROUND(MIN(cd.city_day_value), 2) AS min_city_day_value,
                ROUND(AVG(cd.stations_with_data), 2) AS avg_stations_with_data
            FROM city_daily cd
            GROUP BY cd.city
        ),
        city_station_counts AS (
            SELECT
                s.city_name AS city,
                COUNT(DISTINCT sd.station_id) AS stations_count
            FROM station_daily sd
            JOIN stations s ON s.id = sd.station_id
            WHERE s.city_name IS NOT NULL AND s.city_name != ''
            GROUP BY s.city_name
        )
        SELECT
            cs.city,
            cs.exceedance_days,
            cs.days_with_data,
            cs.exceedance_pct,
            cs.avg_city_day_value,
            cs.max_city_day_value,
            cs.min_city_day_value,
            cs.avg_stations_with_data,
            COALESCE(sc.stations_count, 0) AS stations_count
        FROM city_stats cs
        LEFT JOIN city_station_counts sc ON sc.city = cs.city
        ORDER BY cs.exceedance_days DESC, cs.exceedance_pct DESC, cs.city ASC
        """

        params: Tuple[Any, ...] = (
            pollutant,
            start,
            end,
            MIN_HOURLY_VALUES_PER_DAY,
            threshold_value,
            threshold_value,
        )

        rows: List[Dict[str, Any]] = []

        async with aiosqlite.connect(self.cache.db_path) as db:
            await self.cache._configure_connection(db)
            cursor = await db.execute(query, params)
            fetched = await cursor.fetchall()

        for idx, r in enumerate(fetched, start=1):
            (
                city,
                exceedance_days,
                days_with_data,
                exceedance_pct,
                avg_city_day_value,
                max_city_day_value,
                min_city_day_value,
                avg_stations_with_data,
                stations_count,
            ) = r

            exceedance_days = int(exceedance_days or 0)
            days_with_data = int(days_with_data or 0)

            rows.append(
                {
                    "rank": idx,
                    "city": city,
                    "exceedance_days": exceedance_days,
                    "days_with_data": days_with_data,
                    "exceedance_pct": float(exceedance_pct or 0.0),
                    "avg_city_day_value": float(avg_city_day_value or 0.0),
                    "max_city_day_value": float(max_city_day_value or 0.0),
                    "min_city_day_value": float(min_city_day_value or 0.0),
                    "avg_stations_with_data": float(avg_stations_with_data or 0.0),
                    "stations_count": int(stations_count or 0),
                    "exceeds_allowed_exceedances": exceedance_days > allowed_exceedances_per_year,
                }
            )

        return RankingResult(
            year=year,
            pollutant=pollutant,
            method=method,
            threshold_value=threshold_value,
            allowed_exceedances_per_year=allowed_exceedances_per_year,
            days_rule=days_rule,
            computed_at=computed_at,
            cities=rows,
        )

    async def compute_trends(
        self,
        *,
        pollutant: str,
        method: RankingMethod,
        standard: RankingStandard,
    ) -> RankingTrendResult:
        """
        Compute multi-year trends using the 'Annual Cache' strategy.
        1. Fetch cached years.
        2. Identify missing years (or current year which needs refresh).
        3. Compute missing/current years from raw data.
        4. Upsert new stats.
        5. Return combined result.
        """
        if standard == "who":
            if pollutant not in WHO_DAILY_LIMITS:
                raise ValueError(f"No WHO limit for {pollutant}")
            threshold_value = WHO_DAILY_LIMITS[pollutant]
        else:
            if pollutant not in EU_2030_DAILY_LIMITS:
                raise ValueError(f"No EU limit for {pollutant}")
            threshold_value = EU_2030_DAILY_LIMITS[pollutant].threshold_value

        # 1. Determine available years in raw data
        available_years = await self.cache.get_available_years_for_pollutant(pollutant)
        if not available_years:
            return RankingTrendResult(
                pollutant=pollutant,
                method=method,
                standard=standard,
                threshold_value=threshold_value,
                years=[],
                cities=[],
                points=[],
            )

        min_year, max_year = min(available_years), max(available_years)
        # We want to cover range [min_year, max_year]
        years_to_cover = list(range(min_year, max_year + 1))
        
        current_year = datetime.now().year

        # 2. Fetch what we already have in cache
        cached_stats = await self.cache.get_annual_stats(
            pollutant_code=pollutant,
            ranking_method=method,
            standard_type=standard,
        )

        # Build a map of what's cached: year -> set(cities)
        # Actually, simpler: map (year) -> is_fully_cached? 
        # But we can't know if it's "fully" cached without knowing all cities.
        # Strategy:
        # - Past years ( < current_year): If present in cache, assume done.
        # - Current year: Recompute only if cache is stale (> 1 hour old).
        # - Missing years: Compute.
        
        CURRENT_YEAR_CACHE_TTL_SECONDS = 3600  # 1 hour
        
        cached_years = set(r["year"] for r in cached_stats)
        
        years_to_compute = []
        for y in years_to_cover:
            if y == current_year:
                # Check if current year cache is fresh enough
                cached_entry = next((r for r in cached_stats if r["year"] == y), None)
                if cached_entry:
                    computed_at_str = cached_entry.get("computed_at", "")
                    try:
                        cache_time = datetime.fromisoformat(computed_at_str)
                        age_seconds = (datetime.utcnow() - cache_time).total_seconds()
                        if age_seconds < CURRENT_YEAR_CACHE_TTL_SECONDS:
                            # Cache is fresh, skip recomputation
                            continue
                    except (ValueError, TypeError):
                        pass  # If parsing fails, recompute
                years_to_compute.append(y)
            elif y not in cached_years:
                years_to_compute.append(y)
        
        # 3. Compute missing years
        if years_to_compute:
            new_rows = []
            agg_expr = _city_agg_expr(method)
            computed_at = datetime.utcnow().isoformat()

            async with aiosqlite.connect(self.cache.db_path) as db:
                await self.cache._configure_connection(db)
                
                # We can do one big query with GROUP BY year, or loop.
                # Looping is safer to avoid massive memory usage if many years.
                # But since we only have ~15 years, one query is fine?
                # Actually, let's loop to be safe and clear.
                
                for y in years_to_compute:
                    start = f"{y:04d}-01-01 00:00:00"
                    end = f"{y + 1:04d}-01-01 00:00:00"
                    
                    query = f"""
                    WITH station_daily AS (
                        SELECT
                            m.station_id AS station_id,
                            date(m.date) AS day,
                            AVG(m.value) AS station_day_avg,
                            COUNT(m.value) AS station_day_count
                        FROM measurements m
                        WHERE m.pollutant_code = ?
                          AND m.date >= ? AND m.date < ?
                          AND m.value IS NOT NULL
                        GROUP BY m.station_id, day
                        HAVING station_day_count >= ?
                    ),
                    city_daily AS (
                        SELECT
                            s.city_name AS city,
                            sd.day AS day,
                            {agg_expr} AS city_day_value
                        FROM station_daily sd
                        JOIN stations s ON s.id = sd.station_id
                        WHERE s.city_name IS NOT NULL AND s.city_name != ''
                        GROUP BY s.city_name, sd.day
                    )
                    SELECT
                        cd.city,
                        SUM(CASE WHEN cd.city_day_value > ? THEN 1 ELSE 0 END) AS exceedance_days,
                        COUNT(*) AS total_days
                    FROM city_daily cd
                    GROUP BY cd.city
                    """
                    
                    params = (pollutant, start, end, MIN_HOURLY_VALUES_PER_DAY, threshold_value)
                    cursor = await db.execute(query, params)
                    rows = await cursor.fetchall()
                    
                    for r in rows:
                        city, exc_days, tot_days = r
                        new_rows.append((
                            y, 
                            city, 
                            pollutant, 
                            method, 
                            standard, 
                            threshold_value, 
                            int(exc_days), 
                            int(tot_days), 
                            computed_at
                        ))

            # 4. Upsert new stats
            if new_rows:
                await self.cache.upsert_annual_stats(new_rows)
                
            # Refresh cached_stats after update
            cached_stats = await self.cache.get_annual_stats(
                pollutant_code=pollutant,
                ranking_method=method,
                standard_type=standard,
            )

        # 5. Format result
        # cached_stats is List[Dict] sorted by year, city
        
        # We need to pivot to: points = [{year: 2010, CityA: 50, CityB: 20}, ...]
        points_map: Dict[int, Dict[str, Any]] = {}
        all_cities = set()
        
        for row in cached_stats:
            y = row["year"]
            c = row["city"]
            val = row["exceedance_days"]
            
            if y not in points_map:
                points_map[y] = {"year": y}
            
            points_map[y][c] = val
            all_cities.add(c)

        # Sort years
        sorted_years = sorted(points_map.keys())
        points = [points_map[y] for y in sorted_years]

        return RankingTrendResult(
            pollutant=pollutant,
            method=method,
            standard=standard,
            threshold_value=threshold_value,
            years=sorted_years,
            cities=sorted(list(all_cities)),
            points=points,
        )
