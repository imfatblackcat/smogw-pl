"""Data models for Air Quality API."""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class Station(BaseModel):
    """Air quality monitoring station."""
    id: int = Field(alias="Identyfikator stacji")
    code: str = Field(alias="Kod stacji")
    name: str = Field(alias="Nazwa stacji")
    latitude: str = Field(alias="WGS84 φ N")
    longitude: str = Field(alias="WGS84 λ E")
    city_id: int = Field(alias="Identyfikator miasta")
    city_name: str = Field(alias="Nazwa miasta")
    commune: str = Field(alias="Gmina")
    district: str = Field(alias="Powiat")
    voivodeship: str = Field(alias="Województwo")
    street: Optional[str] = Field(None, alias="Ulica")

    class Config:
        populate_by_name = True


class Sensor(BaseModel):
    """Sensor at a monitoring station."""
    id: int = Field(alias="Identyfikator stanowiska")
    station_id: int = Field(alias="Identyfikator stacji")
    pollutant_name: str = Field(alias="Wskaźnik")
    pollutant_code: str = Field(alias="Wskaźnik - wzór")
    pollutant_id: int = Field(alias="Identyfikator wskaźnika")

    class Config:
        populate_by_name = True


class Measurement(BaseModel):
    """Single measurement reading."""
    date: datetime = Field(alias="Data")
    value: Optional[float] = Field(None, alias="Wartość")

    class Config:
        populate_by_name = True


class CityInfo(BaseModel):
    """Information about a city."""
    name: str
    station_count: int
    stations: List[Station]


class PollutantInfo(BaseModel):
    """Information about a pollutant type."""
    code: str
    name: str
    unit: str = "μg/m³"


class DataRequest(BaseModel):
    """Request for air quality data."""
    cities: List[str]
    pollutant: str
    start_date: str
    end_date: str
    stations: Optional[List[int]] = None
    aggregation: str = "daily"  # hourly, daily, weekly, monthly


class DataPoint(BaseModel):
    """Single data point in time series."""
    timestamp: str
    value: Optional[float]
    city: str
    station_id: Optional[int] = None
    station_name: Optional[str] = None


class DataResponse(BaseModel):
    """Response with air quality data."""
    data: List[DataPoint]
    pollutant: PollutantInfo
    date_range: dict
