import { useState, useEffect, useMemo, useCallback } from 'react';
import { subYears } from 'date-fns';
import { format } from 'date-fns';
import { fetchCities, fetchPollutants, fetchAirQualityData } from '@/services/api';
import type { City, Pollutant, DataPoint, AggregationType } from '../types';

interface UseAirQualityDataReturn {
  // Data
  cities: City[];
  pollutants: Pollutant[];
  dataByPollutant: Map<string, DataPoint[]>;
  stationIdToCity: Map<string, string>;
  
  // Filter state
  selectedStationIds: string[];
  selectedPollutants: string[];
  showAverage: boolean;
  startDate: Date;
  endDate: Date;
  aggregation: AggregationType;
  
  // Loading state
  loading: boolean;
  initialLoading: boolean;
  error: string | null;
  
  // Actions
  setSelectedStationIds: (ids: string[]) => void;
  setSelectedPollutants: (codes: string[]) => void;
  setShowAverage: (show: boolean) => void;
  setStartDate: (date: Date) => void;
  setEndDate: (date: Date) => void;
  setAggregation: (agg: AggregationType) => void;
  fetchData: () => Promise<void>;
}

export function useAirQualityData(): UseAirQualityDataReturn {
  // Initial data
  const [cities, setCities] = useState<City[]>([]);
  const [pollutants, setPollutants] = useState<Pollutant[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  
  // Filter state
  const [selectedStationIds, setSelectedStationIds] = useState<string[]>([]);
  const [selectedPollutants, setSelectedPollutants] = useState<string[]>([]);
  const [showAverage, setShowAverage] = useState(false);
  const [startDate, setStartDate] = useState(() => subYears(new Date(), 1));
  const [endDate, setEndDate] = useState(() => new Date());
  const [aggregation, setAggregation] = useState<AggregationType>('daily');
  
  // Data state
  const [dataByPollutant, setDataByPollutant] = useState<Map<string, DataPoint[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mapping station ID -> city name
  const stationIdToCity = useMemo(() => {
    const map = new Map<string, string>();
    for (const city of cities) {
      for (const station of city.stations) {
        map.set(String(station.id), city.name);
      }
    }
    return map;
  }, [cities]);

  // Get cities for selected stations
  const selectedCities = useMemo(() => {
    const citySet = new Set<string>();
    for (const stationId of selectedStationIds) {
      const city = stationIdToCity.get(stationId);
      if (city) {
        citySet.add(city);
      }
    }
    return Array.from(citySet);
  }, [selectedStationIds, stationIdToCity]);

  // Load initial data (cities & pollutants)
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [citiesData, pollutantsData] = await Promise.all([
          fetchCities(),
          fetchPollutants(),
        ]);

        setCities(citiesData.cities || []);
        setPollutants(pollutantsData.pollutants || []);
        
        // Default select all pollutants
        if (pollutantsData.pollutants?.length > 0) {
          setSelectedPollutants(pollutantsData.pollutants.map((p) => p.code));
        }
      } catch (err) {
        setError('Błąd podczas ładowania danych: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setInitialLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Fetch air quality data
  const fetchData = useCallback(async () => {
    if (selectedStationIds.length === 0) {
      setError('Wybierz przynajmniej jedną stację');
      return;
    }

    if (selectedPollutants.length === 0) {
      setError('Wybierz przynajmniej jedno zanieczyszczenie');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');
      
      // Fetch data for each pollutant in parallel
      const results = await Promise.all(
        selectedPollutants.map(async (pollutantCode) => {
          const response = await fetchAirQualityData({
            cities: selectedCities,
            pollutant: pollutantCode,
            startDate: startDateStr,
            endDate: endDateStr,
            stationIds: selectedStationIds.map(Number),
            aggregation,
          });
          return { pollutantCode, data: response.data };
        })
      );

      // Build map of pollutant -> data
      const newDataByPollutant = new Map<string, DataPoint[]>();
      for (const { pollutantCode, data } of results) {
        newDataByPollutant.set(pollutantCode, data);
      }
      
      setDataByPollutant(newDataByPollutant);
    } catch (err) {
      setError('Błąd podczas pobierania danych: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [selectedStationIds, selectedPollutants, selectedCities, startDate, endDate, aggregation]);

  return {
    // Data
    cities,
    pollutants,
    dataByPollutant,
    stationIdToCity,
    
    // Filter state
    selectedStationIds,
    selectedPollutants,
    showAverage,
    startDate,
    endDate,
    aggregation,
    
    // Loading state
    loading,
    initialLoading,
    error,
    
    // Actions
    setSelectedStationIds,
    setSelectedPollutants,
    setShowAverage,
    setStartDate,
    setEndDate,
    setAggregation,
    fetchData,
  };
}
