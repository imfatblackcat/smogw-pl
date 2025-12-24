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


@dataclass(frozen=True)
class EUDailyLimit:
    threshold_value: float
    allowed_exceedances_per_year: int


EU_2030_DAILY_LIMITS: Dict[str, EUDailyLimit] = {
    "PM10": EUDailyLimit(threshold_value=45.0, allowed_exceedances_per_year=18),
    "PM2.5": EUDailyLimit(threshold_value=25.0, allowed_exceedances_per_year=18),
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
