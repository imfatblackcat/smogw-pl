"""Data processor for air quality data."""
from datetime import datetime
import re
import unicodedata
from typing import List, Dict, Any, Optional
from statistics import mean


# Wszystkie miasta wojewódzkie w Polsce (18 miast)
MAJOR_CITIES = [
    # Oryginalne 10 największych
    "Warszawa", "Kraków", "Łódź", "Wrocław", "Poznań",
    "Gdańsk", "Szczecin", "Bydgoszcz", "Lublin", "Katowice",
    # Pozostałe miasta wojewódzkie
    "Białystok",       # podlaskie
    "Kielce",          # świętokrzyskie
    "Olsztyn",         # warmińsko-mazurskie
    "Rzeszów",         # podkarpackie
    "Opole",           # opolskie
    "Zielona Góra",    # lubuskie
    "Gorzów Wielkopolski",  # lubuskie (drugie)
    "Toruń",           # kujawsko-pomorskie (drugie)
]

# Mapowanie kodów zanieczyszczeń
POLLUTANTS = {
    "PM10": {"name": "Pył zawieszony PM10", "unit": "μg/m³"},
    "PM2.5": {"name": "Pył zawieszony PM2.5", "unit": "μg/m³"},
    "NO2": {"name": "Dwutlenek azotu", "unit": "μg/m³"},
    "SO2": {"name": "Dwutlenek siarki", "unit": "μg/m³"},
    "O3": {"name": "Ozon", "unit": "μg/m³"},
    "CO": {"name": "Tlenek węgla", "unit": "μg/m³"},
    "C6H6": {"name": "Benzen", "unit": "μg/m³"},
}


def _normalize_city(value: Any) -> str:
    """Normalize city-like text for comparisons.

    Important: we do NOT do substring matching, to avoid collisions like:
    - Szczecin vs Szczecinek
    - Wrocław vs Inowrocław
    - Opole vs Wilczopole
    """
    if value is None:
        return ""

    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    text = text.casefold()

    # 'ł' is not reliably decomposed by NFKD on all platforms, handle explicitly.
    text = text.replace("ł", "l")

    # Strip diacritics (Kraków -> krakow, Łódź -> lodz, etc.)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))

    return text


def _contains_as_whole_phrase(text: str, phrase: str) -> bool:
    if not text or not phrase:
        return False
    pattern = r"\b" + re.escape(phrase) + r"\b"
    return re.search(pattern, text) is not None


class DataProcessor:
    """Processes and aggregates air quality data."""

    @staticmethod
    def filter_stations_by_city(
        stations: List[Dict[str, Any]],
        city_name: str,
    ) -> List[Dict[str, Any]]:
        """Filter stations by city name.

        We intentionally match by (normalized) equality on "Nazwa miasta".
        This prevents substring collisions (e.g. Szczecin/Szczecinek).

        A conservative fallback matches "Nazwa stacji" only when "Nazwa miasta" is missing,
        and only as a whole word/phrase.
        """
        city_norm = _normalize_city(city_name)
        if not city_norm:
            return []

        out: List[Dict[str, Any]] = []
        for s in stations:
            station_city_norm = _normalize_city(s.get("Nazwa miasta", ""))
            if station_city_norm and station_city_norm == city_norm:
                out.append(s)
                continue

            # Fallback: if upstream city is missing, try a safe whole-phrase match on station name.
            if not station_city_norm:
                station_name_norm = _normalize_city(s.get("Nazwa stacji", ""))
                if _contains_as_whole_phrase(station_name_norm, city_norm):
                    out.append(s)

        return out

    @staticmethod
    def group_stations_by_city(
        stations: List[Dict[str, Any]],
        cities: Optional[List[str]] = None,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Group stations by a configured list of cities.

        Grouping is done strictly by station "Nazwa miasta" (after normalization).
        """
        cities = cities or MAJOR_CITIES
        grouped = {city: [] for city in cities}

        city_by_norm = {_normalize_city(c): c for c in cities}

        for station in stations:
            station_city = station.get("Nazwa miasta", "")
            target_city = city_by_norm.get(_normalize_city(station_city))
            if target_city:
                grouped[target_city].append(station)

        return grouped
    
    @staticmethod
    def aggregate_measurements(
        measurements: List[Dict[str, Any]],
        aggregation: str = "daily"
    ) -> List[Dict[str, Any]]:
        """Aggregate measurements by time period."""
        if not measurements:
            return []
        
        # Group by time period
        grouped = {}
        
        for measurement in measurements:
            date_str = measurement.get("Data")
            if not date_str:
                continue
            
            try:
                date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            except:
                continue
            
            # Generate grouping key based on aggregation type
            if aggregation == "hourly":
                key = date.strftime("%Y-%m-%d %H:00:00")
            elif aggregation == "daily":
                key = date.strftime("%Y-%m-%d")
            elif aggregation == "weekly":
                iso = date.isocalendar()
                key = f"{iso.year}-W{iso.week:02d}"
            elif aggregation == "monthly":
                key = date.strftime("%Y-%m")
            else:
                key = date.strftime("%Y-%m-%d")
            
            if key not in grouped:
                grouped[key] = []
            
            value = measurement.get("Wartość")
            if value is not None:
                grouped[key].append(value)
        
        # Calculate averages
        result = []
        for key, values in sorted(grouped.items()):
            if values:
                result.append({
                    "Data": key,
                    "Wartość": round(mean(values), 2)
                })
        
        return result
    
    @staticmethod
    def calculate_city_average(
        measurements_by_station: Dict[int, List[Dict[str, Any]]]
    ) -> List[Dict[str, Any]]:
        """Calculate average across multiple stations for a city."""
        # Group all measurements by timestamp
        by_timestamp = {}
        
        for station_id, measurements in measurements_by_station.items():
            for m in measurements:
                timestamp = m.get("Data")
                value = m.get("Wartość")
                
                if timestamp and value is not None:
                    if timestamp not in by_timestamp:
                        by_timestamp[timestamp] = []
                    by_timestamp[timestamp].append(value)
        
        # Calculate averages
        result = []
        for timestamp, values in sorted(by_timestamp.items()):
            if values:
                result.append({
                    "Data": timestamp,
                    "Wartość": round(mean(values), 2)
                })
        
        return result
