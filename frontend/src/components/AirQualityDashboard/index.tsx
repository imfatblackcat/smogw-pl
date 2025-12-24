import { Wind, AlertCircle, Loader2 } from 'lucide-react';
import { FilterBar } from './FilterBar';
import { PollutantChart } from './PollutantChart';
import { useAirQualityData } from './hooks/useAirQualityData';

export function AirQualityDashboard() {
  const {
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
  } = useAirQualityData();

  // Get selected pollutant objects
  const selectedPollutantObjects = pollutants.filter((p) =>
    selectedPollutants.includes(p.code)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 rounded-xl">
              <Wind className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">
                smogw.pl
              </h1>
              <p className="text-blue-100 mt-1">
                Wizualizacja jakości powietrza - dane historyczne z GIOŚ
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Initial Loading */}
        {initialLoading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
            <p className="mt-4 text-gray-600">Ładowanie miast i stacji...</p>
          </div>
        ) : cities.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="mt-4 text-gray-600">
              Brak dostępnych miast. Backend może być wyłączony.
            </p>
          </div>
        ) : (
          <>
            {/* Filter Bar */}
            <FilterBar
              cities={cities}
              pollutants={pollutants}
              selectedStationIds={selectedStationIds}
              selectedPollutants={selectedPollutants}
              showAverage={showAverage}
              startDate={startDate}
              endDate={endDate}
              aggregation={aggregation}
              loading={loading}
              onStationIdsChange={setSelectedStationIds}
              onPollutantsChange={setSelectedPollutants}
              onShowAverageChange={setShowAverage}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              onAggregationChange={setAggregation}
              onFetchData={fetchData}
            />

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-700">{error}</p>
              </div>
            )}

            {/* Loading indicator for data fetch */}
            {loading && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
                <p className="mt-3 text-gray-600">Pobieranie danych z GIOŚ API...</p>
                <p className="text-sm text-gray-400 mt-1">
                  To może potrwać kilka minut dla dużych zakresów dat.
                </p>
              </div>
            )}

            {/* Charts */}
            {!loading && dataByPollutant.size > 0 && (
              <div className="space-y-6">
                {selectedPollutantObjects.map((pollutant) => {
                  const data = dataByPollutant.get(pollutant.code) || [];
                  if (data.length === 0) return null;
                  
                  return (
                    <PollutantChart
                      key={pollutant.code}
                      pollutant={pollutant}
                      data={data}
                      showAverage={showAverage}
                      stationIdToCity={stationIdToCity}
                      aggregation={aggregation}
                    />
                  );
                })}
                
                {/* Stats */}
                <div className="text-center text-sm text-gray-500">
                  Łączna liczba punktów danych:{' '}
                  {Array.from(dataByPollutant.values()).reduce(
                    (sum, data) => sum + data.length,
                    0
                  )}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!loading && dataByPollutant.size === 0 && !error && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                  <Wind className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">
                  Brak danych do wyświetlenia
                </h3>
                <p className="mt-2 text-gray-500">
                  Wybierz stacje i zanieczyszczenia, a następnie kliknij "Pobierz dane".
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-500">
            Dane pochodzą z API Głównego Inspektoratu Ochrony Środowiska (GIOŚ)
          </p>
        </div>
      </footer>
    </div>
  );
}

export default AirQualityDashboard;
