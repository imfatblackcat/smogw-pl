#!/usr/bin/env python3
"""
Script to fill data gaps for specific sensors/years.

Usage:
    python fill_gaps.py --sensor-ids 965,995 --years 2020,2021,2022,2023

This script detects months with missing data and fetches them from GIOŚ API.
"""

import argparse
import asyncio
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data_fetcher import GiosDataFetcher
from app.cache_manager import CacheManager


async def get_monthly_counts(db_path: str, sensor_id: int, year: int) -> dict:
    """Get count of measurements per month for a sensor/year."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT strftime('%m', date) as month, COUNT(*) as cnt
        FROM measurements 
        WHERE sensor_id = ?
        AND date >= ? AND date < ?
        GROUP BY month
        ORDER BY month
    ''', (sensor_id, f'{year}-01-01', f'{year+1}-01-01'))
    
    result = {int(row[0]): row[1] for row in cursor.fetchall()}
    conn.close()
    return result


async def get_sensor_info(db_path: str, sensor_id: int) -> dict:
    """Get sensor and station info."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT ss.id, ss.station_id, ss.pollutant_code, s.name, s.city_name
        FROM sensors ss
        JOIN stations s ON s.id = ss.station_id
        WHERE ss.id = ?
    ''', (sensor_id,))
    
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            'sensor_id': row[0],
            'station_id': row[1],
            'pollutant_code': row[2],
            'station_name': row[3],
            'city_name': row[4],
        }
    return {}


def get_expected_hourly_per_month(year: int, month: int) -> int:
    """Get expected hourly measurements for a month."""
    import calendar
    days = calendar.monthrange(year, month)[1]
    return days * 24


async def fill_gaps_for_sensor(
    fetcher: GiosDataFetcher,
    cache: CacheManager,
    db_path: str,
    sensor_id: int,
    years: list[int],
    min_coverage_pct: float = 50.0,
):
    """Fill data gaps for a sensor."""
    info = await get_sensor_info(db_path, sensor_id)
    if not info:
        print(f"Sensor {sensor_id} not found in database")
        return
    
    station_id = info['station_id']
    pollutant_code = info['pollutant_code']
    
    print(f"\n{'='*60}")
    print(f"Sensor {sensor_id}: {info['city_name']} - {info['station_name']}")
    print(f"Pollutant: {pollutant_code}")
    print(f"{'='*60}")
    
    total_fetched = 0
    
    for year in years:
        monthly_counts = await get_monthly_counts(db_path, sensor_id, year)
        
        months_to_fetch = []
        for month in range(1, 13):
            expected = get_expected_hourly_per_month(year, month)
            actual = monthly_counts.get(month, 0)
            coverage = (actual / expected) * 100 if expected > 0 else 0
            
            if coverage < min_coverage_pct:
                months_to_fetch.append((month, actual, expected, coverage))
        
        if not months_to_fetch:
            print(f"\n  {year}: All months have >= {min_coverage_pct}% coverage ✓")
            continue
        
        print(f"\n  {year}: {len(months_to_fetch)} months below {min_coverage_pct}% coverage:")
        for month, actual, expected, coverage in months_to_fetch:
            month_name = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 
                          'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'][month-1]
            print(f"      {month_name}: {actual}/{expected} ({coverage:.1f}%)")
        
        # Fetch missing data for each month
        for month, actual, expected, coverage in months_to_fetch:
            import calendar
            days_in_month = calendar.monthrange(year, month)[1]
            
            start_date = datetime(year, month, 1, 0, 0)
            end_date = datetime(year, month, days_in_month, 23, 59)
            
            month_name = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 
                          'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'][month-1]
            
            print(f"\n    Fetching {year}-{month_name}...", end=" ", flush=True)
            
            try:
                measurements = await fetcher.fetch_sensor_data(sensor_id, start_date, end_date)
                if measurements:
                    await cache.cache_measurements(sensor_id, station_id, pollutant_code, measurements)
                    print(f"✓ {len(measurements)} points")
                    total_fetched += len(measurements)
                else:
                    print(f"✗ No data available from API")
            except Exception as e:
                print(f"✗ Error: {e}")
    
    print(f"\n  Total fetched for sensor {sensor_id}: {total_fetched} points")
    return total_fetched


async def main():
    parser = argparse.ArgumentParser(description='Fill data gaps for specific sensors/years')
    parser.add_argument('--sensor-ids', type=str, required=True,
                        help='Comma-separated list of sensor IDs (e.g., 965,995)')
    parser.add_argument('--years', type=str, required=True,
                        help='Comma-separated list of years (e.g., 2020,2021,2022,2023)')
    parser.add_argument('--min-coverage', type=float, default=50.0,
                        help='Minimum coverage percentage threshold (default: 50)')
    parser.add_argument('--db-path', type=str, default=None,
                        help='Path to cache.db (default: backend/data/cache.db)')
    
    args = parser.parse_args()
    
    sensor_ids = [int(x.strip()) for x in args.sensor_ids.split(',')]
    years = [int(x.strip()) for x in args.years.split(',')]
    
    # Determine DB path
    if args.db_path:
        db_path = args.db_path
    else:
        db_path = str(Path(__file__).resolve().parents[1] / 'data' / 'cache.db')
    
    print(f"Database: {db_path}")
    print(f"Sensors: {sensor_ids}")
    print(f"Years: {years}")
    print(f"Min coverage threshold: {args.min_coverage}%")
    
    # Initialize components
    fetcher = GiosDataFetcher()
    cache = CacheManager(db_path=db_path)
    await cache.initialize()
    
    grand_total = 0
    for sensor_id in sensor_ids:
        total = await fill_gaps_for_sensor(
            fetcher=fetcher,
            cache=cache,
            db_path=db_path,
            sensor_id=sensor_id,
            years=years,
            min_coverage_pct=args.min_coverage,
        )
        if total:
            grand_total += total
    
    print(f"\n{'='*60}")
    print(f"GRAND TOTAL: {grand_total} points fetched")
    print(f"{'='*60}")


if __name__ == "__main__":
    asyncio.run(main())
