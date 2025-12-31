#!/usr/bin/env python3
"""Quick script to check production database statistics."""
import sqlite3
import sys
import os

db_path = os.getenv("DATABASE_PATH", "/app/data/cache.db")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Total measurements
    cursor.execute("SELECT COUNT(*) as total, MIN(date) as oldest, MAX(date) as newest FROM measurements")
    total, oldest, newest = cursor.fetchone()
    print(f"Total measurements: {total:,}")
    print(f"Oldest: {oldest}")
    print(f"Newest: {newest}")
    print()
    
    # By year
    cursor.execute("""
        SELECT strftime('%Y', date) as year, COUNT(*) as count 
        FROM measurements 
        GROUP BY year 
        ORDER BY year
    """)
    print("By year:")
    for row in cursor.fetchall():
        if row[0]:
            print(f"  {row[0]}: {row[1]:,}")
    print()
    
    # By pollutant
    cursor.execute("""
        SELECT pollutant_code, COUNT(*) as count, MIN(date) as oldest
        FROM measurements 
        GROUP BY pollutant_code 
        ORDER BY count DESC
    """)
    print("By pollutant:")
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,} (oldest: {row[2]})")
    
    conn.close()
    
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
