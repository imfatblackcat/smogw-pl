import { useMemo } from 'react';
import { BarChart3, ToggleLeft, ToggleRight, Info } from 'lucide-react';
import { MultiSelect } from './MultiSelect';
import { DateRangePicker } from './DateRangePicker';
import type { City, Pollutant, AggregationType, GroupedSelectOptions, SelectOption } from './types';

interface FilterBarProps {
  cities: City[];
  pollutants: Pollutant[];
  selectedStationIds: string[];
  selectedPollutants: string[];
  showAverage: boolean;
  startDate: Date;
  endDate: Date;
  aggregation: AggregationType;
  loading: boolean;
  onStationIdsChange: (ids: string[]) => void;
  onPollutantsChange: (codes: string[]) => void;
  onShowAverageChange: (show: boolean) => void;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
  onAggregationChange: (agg: AggregationType) => void;
  onFetchData: () => void;
}

export function FilterBar({
  cities,
  pollutants,
  selectedStationIds,
  selectedPollutants,
  showAverage,
  startDate,
  endDate,
  aggregation,
  loading,
  onStationIdsChange,
  onPollutantsChange,
  onShowAverageChange,
  onStartDateChange,
  onEndDateChange,
  onAggregationChange,
  onFetchData,
}: FilterBarProps) {
  // Group stations by city for multi-select
  const stationOptions: GroupedSelectOptions[] = useMemo(() => {
    return cities.map((city) => ({
      heading: city.name,
      options: city.stations.map((s) => ({
        value: String(s.id),
        label: s.name,
      })),
    }));
  }, [cities]);

  // Pollutants as flat options
  const pollutantOptions: SelectOption[] = useMemo(() => {
    return pollutants.map((p) => ({
      value: p.code,
      label: `${p.name} (${p.code})`,
    }));
  }, [pollutants]);

  // Count selected cities
  const selectedCitiesCount = useMemo(() => {
    const citySet = new Set<string>();
    for (const city of cities) {
      for (const station of city.stations) {
        if (selectedStationIds.includes(String(station.id))) {
          citySet.add(city.name);
          break;
        }
      }
    }
    return citySet.size;
  }, [cities, selectedStationIds]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="p-2 bg-blue-100 rounded-lg">
          <BarChart3 className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Filtry</h2>
          <p className="text-sm text-gray-500">Wybierz parametry do wizualizacji</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Stations multi-select */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Stacje pomiarowe
          </label>
          <MultiSelect
            options={stationOptions}
            value={selectedStationIds}
            onChange={onStationIdsChange}
            placeholder="Wybierz stacje..."
            footer={
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Wybrano {selectedStationIds.length} stacji z {selectedCitiesCount} miast
                </span>
              </div>
            }
          />
        </div>

        {/* Pollutants multi-select */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Zanieczyszczenia
          </label>
          <MultiSelect
            options={[{ heading: 'Zanieczyszczenia', options: pollutantOptions }]}
            value={selectedPollutants}
            onChange={onPollutantsChange}
            placeholder="Wybierz zanieczyszczenia..."
          />
        </div>

        {/* Date range picker */}
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={onStartDateChange}
          onEndDateChange={onEndDateChange}
        />

        {/* Aggregation select */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Agregacja
          </label>
          <select
            value={aggregation}
            onChange={(e) => onAggregationChange(e.target.value as AggregationType)}
            className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          >
            <option value="hourly">Godzinowa</option>
            <option value="daily">Dzienna</option>
            <option value="weekly">Tygodniowa</option>
            <option value="monthly">Miesięczna</option>
          </select>
        </div>
      </div>

      {/* Bottom row: toggle + button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-gray-100">
        {/* Average toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onShowAverageChange(!showAverage)}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
              showAverage
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
            }`}
          >
            {showAverage ? (
              <ToggleRight className="w-5 h-5" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
            <span className="text-sm font-medium">
              Pokaż średnią dla miasta
            </span>
          </button>
          <div className="relative group">
            <Info className="w-4 h-4 text-gray-400 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-10">
              Wyświetla średnią wartość z wybranych stacji dla każdego miasta zamiast pojedynczych stacji
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
            </div>
          </div>
        </div>

        {/* Fetch button */}
        <button
          type="button"
          onClick={onFetchData}
          disabled={loading || selectedStationIds.length === 0 || selectedPollutants.length === 0}
          className="px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Pobieranie...
            </span>
          ) : (
            'Pobierz dane'
          )}
        </button>
      </div>
    </div>
  );
}
