import axios from 'axios';
import type { City, Pollutant, DataResponse, FetchDataParams } from '@/components/AirQualityDashboard/types';

// Default to same-origin (works when frontend is served by the backend under smogw.pl).
// For separate deployments, set VITE_API_URL at build time.
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000, // 5 minutes
});

export interface CitiesResponse {
  cities: City[];
}

export interface PollutantsResponse {
  pollutants: Pollutant[];
}

export const fetchCities = async (): Promise<CitiesResponse> => {
  const response = await api.get<CitiesResponse>('/api/cities');
  return response.data;
};

export const fetchPollutants = async (): Promise<PollutantsResponse> => {
  const response = await api.get<PollutantsResponse>('/api/pollutants');
  return response.data;
};

export const fetchAirQualityData = async (params: FetchDataParams): Promise<DataResponse> => {
  const { cities, pollutant, startDate, endDate, stationIds, aggregation } = params;
  
  const queryParams = new URLSearchParams();
  
  // Add cities
  cities.forEach(city => queryParams.append('cities', city));
  
  // Add other params
  queryParams.append('pollutant', pollutant);
  queryParams.append('start_date', startDate);
  queryParams.append('end_date', endDate);
  queryParams.append('aggregation', aggregation || 'daily');
  
  // Add station IDs if specified
  if (stationIds && stationIds.length > 0) {
    stationIds.forEach(id => queryParams.append('station_ids', String(id)));
  }
  
  const response = await api.get<DataResponse>(`/api/data?${queryParams.toString()}`);
  return response.data;
};

// Ranking types
export type RankingMethod = 'city_avg' | 'worst_station' | 'any_station_exceed';

export interface RankingYearsResponse {
  pollutant: string;
  years: number[];
}

export interface CityRankingRow {
  rank: number;
  city: string;
  exceedance_days: number;
  days_with_data: number;
  exceedance_pct: number;
  avg_city_day_value: number;
  max_city_day_value: number;
  min_city_day_value: number;
  avg_stations_with_data: number;
  stations_count: number;
  exceeds_allowed_exceedances: boolean;
}

export interface RankingResponse {
  year: number;
  pollutant: string;
  method: RankingMethod;
  threshold_value: number;
  allowed_exceedances_per_year: number;
  days_rule: string;
  computed_at: string;
  total_cities: number;
  cities: CityRankingRow[];
}

export const fetchRankingYears = async (pollutant: string): Promise<RankingYearsResponse> => {
  const response = await api.get<RankingYearsResponse>('/api/ranking/years', {
    params: { pollutant },
  });
  return response.data;
};

export const fetchRanking = async (params: {
  year: number;
  pollutant: string;
  method?: RankingMethod;
  force?: boolean;
}): Promise<RankingResponse> => {
  const { year, pollutant, method = 'city_avg', force = false } = params;
  const response = await api.get<RankingResponse>('/api/ranking', {
    params: { year, pollutant, method, force },
  });
  return response.data;
};

export default api;
