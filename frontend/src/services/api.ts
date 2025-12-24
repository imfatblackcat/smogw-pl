import axios from 'axios';
import type { City, Pollutant, DataResponse, FetchDataParams } from '@/components/AirQualityDashboard/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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

export default api;
