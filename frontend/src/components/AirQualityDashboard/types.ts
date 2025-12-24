// Station and City types
export interface Station {
  id: number;
  name: string;
  latitude?: string;
  longitude?: string;
  address?: string;
}

export interface City {
  name: string;
  station_count: number;
  stations: Station[];
}

// Pollutant types
export interface Pollutant {
  code: string;
  name: string;
  unit: string;
}

// Data types
export interface DataPoint {
  timestamp: string;
  value: number | null;
  city: string;
  station_id: number | null;
  station_name: string | null;
}

export interface DataResponse {
  data: DataPoint[];
  pollutant: Pollutant;
  date_range: {
    start: string;
    end: string;
  };
  total_points: number;
}

// Filter state
export interface FilterState {
  selectedStationIds: number[];
  selectedPollutants: string[];
  showAverage: boolean;
  startDate: Date;
  endDate: Date;
  aggregation: AggregationType;
}

export type AggregationType = 'hourly' | 'daily' | 'weekly' | 'monthly';

// Chart types
export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  visible: boolean;
  cityName: string;
}

export interface ChartDataPoint {
  timestamp: string;
  [seriesKey: string]: string | number | null;
}

// Grouped options for multi-select
export interface SelectOption {
  value: string;
  label: string;
}

export interface GroupedSelectOptions {
  heading: string;
  options: SelectOption[];
}

// API params
export interface FetchDataParams {
  cities: string[];
  pollutant: string;
  startDate: string;
  endDate: string;
  stationIds?: number[];
  aggregation: AggregationType;
}
