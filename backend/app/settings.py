"""Configuration helpers for the Air Quality backend.

We keep these settings in a dedicated module so both API handlers and background
refresh jobs share the same source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import List, Optional

from .data_processor import MAJOR_CITIES


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_csv(name: str, default: List[str]) -> List[str]:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return list(default)
    parts = [p.strip() for p in value.split(",")]
    return [p for p in parts if p]


@dataclass(frozen=True)
class AirQualitySettings:
    enabled_cities: List[str]

    # Refresh strategy
    refresh_interval_seconds: int
    refresh_overlap_seconds: int

    weekly_sweep_interval_seconds: int
    weekly_sweep_lookback_seconds: int

    # Used when a sensor has no cached measurements yet.
    history_years: int

    # Network/DB tuning
    refresh_concurrency: int
    sqlite_busy_timeout_ms: int


def load_settings(
    *,
    default_cities: Optional[List[str]] = None,
) -> AirQualitySettings:
    """Load settings from environment variables."""
    default_cities = default_cities or list(MAJOR_CITIES)

    return AirQualitySettings(
        enabled_cities=_env_csv("AIRQUALITY_ENABLED_CITIES", default_cities),
        refresh_interval_seconds=_env_int("AIRQUALITY_REFRESH_INTERVAL_SECONDS", 3600),
        refresh_overlap_seconds=_env_int("AIRQUALITY_REFRESH_OVERLAP_SECONDS", 172800),  # 48h
        weekly_sweep_interval_seconds=_env_int("AIRQUALITY_WEEKLY_SWEEP_INTERVAL_SECONDS", 604800),
        weekly_sweep_lookback_seconds=_env_int("AIRQUALITY_WEEKLY_SWEEP_LOOKBACK_SECONDS", 604800),
        history_years=_env_int("AIRQUALITY_HISTORY_YEARS", 15),  # Max available in GIOŚ
        refresh_concurrency=_env_int("AIRQUALITY_REFRESH_CONCURRENCY", 2),  # Reduced to avoid DB locks
        sqlite_busy_timeout_ms=_env_int("AIRQUALITY_SQLITE_BUSY_TIMEOUT_MS", 30000),  # 30s timeout
    )
