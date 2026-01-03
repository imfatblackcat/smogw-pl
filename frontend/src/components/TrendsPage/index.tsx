import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, LineChart as LineChartIcon, Loader2, Info, TrendingDown, TrendingUp, Minus, Table as TableIcon, ChevronUp, ChevronDown, Wind } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchTrends, fetchDataCoverage, type RankingMethod, type TrendsResponse, type DataCoverageResponse } from '@/services/api';

const POLLUTANTS = [
  { code: 'PM10', label: 'PM10' },
  { code: 'PM2.5', label: 'PM2.5' },
] as const;

// WHO daily limits (µg/m³)
const WHO_LIMITS = {
  'PM10': 45,
  'PM2.5': 15,
} as const;

// Colors for chart lines
const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c',
  '#0891b2', '#db2777', '#ca8a04', '#4f46e5', '#be123c',
  '#059669', '#7c3aed', '#b91c1c', '#047857', '#0369a1',
  '#6d28d9', '#be185d', '#a16207', '#4338ca', '#9f1239',
];

// Helper to calculate percentage change
function calcChange(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// Change cell component
function ChangeCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-gray-400">—</span>;
  }

  const isImprovement = value < 0;
  const isWorse = value > 0;
  const Icon = isImprovement ? TrendingDown : isWorse ? TrendingUp : Minus;

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${isImprovement ? 'text-green-600' : isWorse ? 'text-red-600' : 'text-gray-500'
      }`}>
      <Icon className="w-3 h-3" />
      {value > 0 ? '+' : ''}{value}%
    </span>
  );
}

// Sortable column types
type SortColumn = 'city' | 'current' | 'y1' | 'y3' | 'y5' | 'y10';
type SortDirection = 'asc' | 'desc';

// Sortable header component
function SortableHeader({
  column,
  currentSort,
  direction,
  onSort,
  children
}: {
  column: SortColumn;
  currentSort: SortColumn;
  direction: SortDirection;
  onSort: (col: SortColumn) => void;
  children: React.ReactNode;
}) {
  const isActive = currentSort === column;
  return (
    <th
      scope="col"
      className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
      onClick={() => onSort(column)}
    >
      <div className="inline-flex items-center gap-1">
        {children}
        {isActive && (direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </div>
    </th>
  );
}

interface CityChangeRow {
  city: string;
  currentYear: number;
  currentValue: number | undefined;
  change1y: number | null;
  change3y: number | null;
  change5y: number | null;
  change10y: number | null;
  oldestChange: number | null;
  oldestYear: number | null;
  // For sorting
  sortValue: number;
}

export function TrendsPage() {
  const [pollutant, setPollutant] = useState<string>('PM10');
  const [method, setMethod] = useState<RankingMethod>('city_avg');

  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidden series (controlled by legend click)
  const [hiddenCities, setHiddenCities] = useState<Set<string>>(new Set());

  // Table sort state
  const [sortColumn, setSortColumn] = useState<SortColumn>('y10');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Coverage data state
  const [coverageData, setCoverageData] = useState<DataCoverageResponse | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'city' ? 'asc' : 'asc'); // For changes, asc = best improvement first
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchTrends({ pollutant, standard: 'who', method });
        if (cancelled) return;
        setData(result);
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message || 'Błąd pobierania danych');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [pollutant, method]);

  // Fetch coverage data when pollutant changes
  useEffect(() => {
    let cancelled = false;

    async function loadCoverage() {
      setCoverageLoading(true);
      try {
        const result = await fetchDataCoverage(pollutant);
        if (cancelled) return;
        setCoverageData(result);
      } catch (e: any) {
        console.error('Error loading coverage:', e);
        if (!cancelled) setCoverageData(null);
      } finally {
        if (!cancelled) setCoverageLoading(false);
      }
    }

    loadCoverage();
    return () => { cancelled = true; };
  }, [pollutant]);


  const toggleCity = (city: string) => {
    const next = new Set(hiddenCities);
    if (next.has(city)) {
      next.delete(city);
    } else {
      next.add(city);
    }
    setHiddenCities(next);
  };

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.points;
  }, [data]);

  const sortedCities = useMemo(() => {
    if (!data) return [];
    return data.cities;
  }, [data]);

  // Calculate change table data
  const changeTableData = useMemo((): { rows: CityChangeRow[], years: { current: number, y1: number, y3: number, y5: number, y10: number, oldest: number } | null } => {
    if (!data || data.years.length < 2) return { rows: [], years: null };

    // Get the current calendar year to determine the "last full year"
    const calendarYear = new Date().getFullYear();
    const sortedYears = [...data.years].sort((a, b) => b - a);

    // Reference year = last full year (e.g., 2025 if we're in 2026)
    const referenceYear = sortedYears.find(y => y < calendarYear) || sortedYears[0];

    // Calculate comparison years based on the reference year
    const year1 = sortedYears.find(y => y <= referenceYear - 1);
    const year3 = sortedYears.find(y => y <= referenceYear - 3);
    const year5 = sortedYears.find(y => y <= referenceYear - 5);
    const year10 = sortedYears.find(y => y <= referenceYear - 10);

    // Build lookup for year data
    const yearData: Record<number, Record<string, number>> = {};
    for (const point of data.points) {
      yearData[point.year] = {};
      for (const city of data.cities) {
        if (point[city] !== undefined) {
          yearData[point.year][city] = point[city] as number;
        }
      }
    }

    // Oldest year = 2015 or earliest available year if 2015 not present
    const sortedYearsAsc = [...data.years].sort((a, b) => a - b);
    const oldestYear = sortedYearsAsc.find(y => y >= 2015) || sortedYearsAsc[0];

    const rows: CityChangeRow[] = data.cities.map(city => {
      const currentValue = yearData[referenceYear]?.[city];
      const value1y = year1 ? yearData[year1]?.[city] : undefined;
      const value3y = year3 ? yearData[year3]?.[city] : undefined;
      const value5y = year5 ? yearData[year5]?.[city] : undefined;
      const value10y = year10 ? yearData[year10]?.[city] : undefined;
      const oldestValue = yearData[oldestYear]?.[city];

      const change1y = calcChange(currentValue, value1y);
      const change3y = calcChange(currentValue, value3y);
      const change5y = calcChange(currentValue, value5y);
      const change10y = calcChange(currentValue, value10y);
      const oldestChange = oldestYear !== referenceYear ? calcChange(currentValue, oldestValue) : null;

      // Sort by 10y change (most negative = biggest improvement first), null last
      const sortValue = change10y !== null ? change10y : 9999;

      return {
        city,
        currentYear: referenceYear,
        currentValue,
        change1y,
        change3y,
        change5y,
        change10y,
        oldestChange,
        oldestYear: oldestYear !== referenceYear ? oldestYear : null,
        sortValue,
      };
    });

    // Sort by greatest improvement (most negative 10y change first)
    rows.sort((a, b) => a.sortValue - b.sortValue);

    return {
      rows,
      years: {
        current: referenceYear,
        y1: year1 || 0,
        y3: year3 || 0,
        y5: year5 || 0,
        y10: year10 || 0,
        oldest: oldestYear,
      }
    };
  }, [data]);

  // Calculate average row
  const avgRow = useMemo(() => {
    if (changeTableData.rows.length === 0) return null;

    const validRows = changeTableData.rows.filter(r => r.currentValue !== undefined);
    if (validRows.length === 0) return null;

    const avgCurrent = Math.round(validRows.reduce((sum, r) => sum + (r.currentValue || 0), 0) / validRows.length);

    const avg1y = validRows.filter(r => r.change1y !== null);
    const avg1yVal = avg1y.length > 0 ? Math.round(avg1y.reduce((sum, r) => sum + r.change1y!, 0) / avg1y.length) : null;

    const avg3y = validRows.filter(r => r.change3y !== null);
    const avg3yVal = avg3y.length > 0 ? Math.round(avg3y.reduce((sum, r) => sum + r.change3y!, 0) / avg3y.length) : null;

    const avg5y = validRows.filter(r => r.change5y !== null);
    const avg5yVal = avg5y.length > 0 ? Math.round(avg5y.reduce((sum, r) => sum + r.change5y!, 0) / avg5y.length) : null;

    const avg10y = validRows.filter(r => r.change10y !== null);
    const avg10yVal = avg10y.length > 0 ? Math.round(avg10y.reduce((sum, r) => sum + r.change10y!, 0) / avg10y.length) : null;

    const avgOldest = validRows.filter(r => r.oldestChange !== null);
    const avgOldestVal = avgOldest.length > 0 ? Math.round(avgOldest.reduce((sum, r) => sum + r.oldestChange!, 0) / avgOldest.length) : null;

    return {
      avgCurrent,
      avg1y: avg1yVal,
      avg3y: avg3yVal,
      avg5y: avg5yVal,
      avg10y: avg10yVal,
      avgOldest: avgOldestVal,
    };
  }, [changeTableData]);

  // Sort rows based on current sort state
  const sortedRows = useMemo(() => {
    const rows = [...changeTableData.rows];

    rows.sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;

      switch (sortColumn) {
        case 'city':
          aVal = a.city;
          bVal = b.city;
          break;
        case 'current':
          aVal = a.currentValue ?? -9999;
          bVal = b.currentValue ?? -9999;
          break;
        case 'y1':
          aVal = a.change1y ?? 9999;
          bVal = b.change1y ?? 9999;
          break;
        case 'y3':
          aVal = a.change3y ?? 9999;
          bVal = b.change3y ?? 9999;
          break;
        case 'y5':
          aVal = a.change5y ?? 9999;
          bVal = b.change5y ?? 9999;
          break;
        case 'y10':
          aVal = a.change10y ?? 9999;
          bVal = b.change10y ?? 9999;
          break;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal, 'pl')
          : bVal.localeCompare(aVal, 'pl');
      }

      const numA = aVal as number;
      const numB = bVal as number;
      return sortDirection === 'asc' ? numA - numB : numB - numA;
    });

    return rows;
  }, [changeTableData.rows, sortColumn, sortDirection]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <header className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm">
                <LineChartIcon className="w-10 h-10" />
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  Trendy Wieloletnie
                </h1>
                <p className="text-blue-100 mt-2 text-lg max-w-xl">
                  Sprawdź, jak zmienia się jakość powietrza w największych polskich miastach na przestrzeni lat
                </p>
              </div>
            </div>

            {/* Call to action */}
            <a
              href="/explorer"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white px-5 py-3 rounded-xl font-medium transition-all hover:scale-105 border border-white/20"
            >
              <Wind className="w-5 h-5" />
              Przejdź do Eksploratora Danych
            </a>
          </div>

          {/* Brief description */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="font-semibold text-white mb-1">📊 15 lat danych</div>
              <div className="text-blue-100">Analiza trendów od 2010 roku do dziś dla miast wojewódzkich w Polsce</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="font-semibold text-white mb-1">🏥 Normy WHO</div>
              <div className="text-blue-100">Porównanie z najnowszymi wytycznymi Światowej Organizacji Zdrowia</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
              <div className="font-semibold text-white mb-1">📈 Dane GIOŚ</div>
              <div className="text-blue-100">Oficjalne pomiary z sieci monitoringu Głównego Inspektoratu Ochrony Środowiska</div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Controls */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Pollutant Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Zanieczyszczenie</label>
              <div className="flex bg-gray-100 p-1 rounded-lg">
                {POLLUTANTS.map((p) => (
                  <button
                    key={p.code}
                    onClick={() => setPollutant(p.code)}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${pollutant === p.code
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                <Info className="w-3 h-3" />
                Norma WHO: przekroczenie gdy średnia dobowa &gt; <strong>{WHO_LIMITS[pollutant as keyof typeof WHO_LIMITS]} µg/m³</strong>
              </p>
            </div>

            {/* Method Info */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Metoda agregacji miasta</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as any)}
                className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5"
              >
                <option value="city_avg">Średnia ze wszystkich stacji</option>
                <option value="worst_station">Najgorsza stacja w mieście</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center text-red-700">
            <AlertCircle className="w-5 h-5 mr-2" />
            {error}
          </div>
        )}

        {loading && (
          <div className="h-96 flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-200">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
            <p className="text-gray-500">Przetwarzanie danych historycznych...</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Chart Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="mb-6 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Wykres liczby dni z przekroczeniem</h3>
                  <p className="text-sm text-gray-500">
                    Kliknij nazwę miasta w legendzie, aby ukryć/pokazać serię.
                  </p>
                </div>
                {/* WHO limit info line */}
                {pollutant === 'PM2.5' && (
                  <div className="flex items-center gap-2 text-xs bg-amber-50 text-amber-800 px-3 py-1.5 rounded-full border border-amber-200">
                    <Info className="w-3 h-3" />
                    WHO zaleca max 3-4 dni przekroczeń rocznie (dla normy 15 µg/m³)
                  </div>
                )}
              </div>

              <div className="h-[500px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis
                      dataKey="year"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      dy={10}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      label={{ value: 'Dni', angle: -90, position: 'insideLeft', fill: '#9ca3af' }}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      labelStyle={{ color: '#111827', fontWeight: 600, marginBottom: '4px' }}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: '20px' }}
                      onClick={(e) => toggleCity(e.value)}
                      formatter={(value, entry: any) => {
                        const isHidden = hiddenCities.has(value);
                        return <span style={{ color: isHidden ? '#d1d5db' : entry.color, textDecoration: isHidden ? 'line-through' : 'none' }}>{value}</span>;
                      }}
                    />



                    {sortedCities.map((city, index) => (
                      <Line
                        key={city}
                        type="monotone"
                        dataKey={city}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3, strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                        hide={hiddenCities.has(city)}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Change Table Section */}
            {changeTableData.years && changeTableData.rows.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <div className="mb-6">
                  <div className="flex items-center gap-3">
                    <TableIcon className="w-5 h-5 text-gray-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Zmiana procentowa liczby dni z przekroczeniem</h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Porównanie roku {changeTableData.years.current} z poprzednimi latami.
                    <span className="text-green-600 ml-2">↓ Zielony = poprawa</span>
                    <span className="text-red-600 ml-2">↑ Czerwony = pogorszenie</span>
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <SortableHeader column="city" currentSort={sortColumn} direction={sortDirection} onSort={handleSort}>
                          <span className="text-left">Miasto</span>
                        </SortableHeader>
                        <SortableHeader column="current" currentSort={sortColumn} direction={sortDirection} onSort={handleSort}>
                          {changeTableData.years.current}<br /><span className="normal-case font-normal">(dni)</span>
                        </SortableHeader>
                        {changeTableData.years.y1 > 0 && (
                          <SortableHeader column="y1" currentSort={sortColumn} direction={sortDirection} onSort={handleSort}>
                            vs {changeTableData.years.y1}<br /><span className="normal-case font-normal">(1 rok)</span>
                          </SortableHeader>
                        )}
                        {changeTableData.years.y3 > 0 && (
                          <SortableHeader column="y3" currentSort={sortColumn} direction={sortDirection} onSort={handleSort}>
                            vs {changeTableData.years.y3}<br /><span className="normal-case font-normal">(3 lata)</span>
                          </SortableHeader>
                        )}
                        {changeTableData.years.y5 > 0 && (
                          <SortableHeader column="y5" currentSort={sortColumn} direction={sortDirection} onSort={handleSort}>
                            vs {changeTableData.years.y5}<br /><span className="normal-case font-normal">(5 lat)</span>
                          </SortableHeader>
                        )}
                        {changeTableData.years.y10 > 0 && (
                          <SortableHeader column="y10" currentSort={sortColumn} direction={sortDirection} onSort={handleSort}>
                            vs {changeTableData.years.y10}<br /><span className="normal-case font-normal">(10 lat)</span>
                          </SortableHeader>
                        )}

                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedRows.map((row, idx) => (
                        <tr key={row.city} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0" style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}>
                            {row.city}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-gray-900 font-semibold">
                            {row.currentValue !== undefined ? row.currentValue : '—'}
                          </td>
                          {changeTableData.years?.y1 && changeTableData.years.y1 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={row.change1y} />
                            </td>
                          )}
                          {changeTableData.years?.y3 && changeTableData.years.y3 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={row.change3y} />
                            </td>
                          )}
                          {changeTableData.years?.y5 && changeTableData.years.y5 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={row.change5y} />
                            </td>
                          )}
                          {changeTableData.years?.y10 && changeTableData.years.y10 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={row.change10y} />
                            </td>
                          )}

                        </tr>
                      ))}
                      {/* Average row */}
                      {avgRow && (
                        <tr className="bg-blue-50 font-medium">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-900 sticky left-0 bg-blue-50">
                            🇵🇱 Średnia krajowa
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-blue-900 font-semibold">
                            {avgRow.avgCurrent}
                          </td>
                          {changeTableData.years.y1 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={avgRow.avg1y} />
                            </td>
                          )}
                          {changeTableData.years.y3 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={avgRow.avg3y} />
                            </td>
                          )}
                          {changeTableData.years.y5 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={avgRow.avg5y} />
                            </td>
                          )}
                          {changeTableData.years.y10 > 0 && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={avgRow.avg10y} />
                            </td>
                          )}

                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Coverage Table Section */}
            {coverageData && !coverageLoading && (

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <div className="mb-6">
                  <div className="flex items-center gap-3">
                    <TableIcon className="w-5 h-5 text-gray-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Kompletność danych pomiarowych</h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Liczba dni z danymi dla {pollutant} w latach 2015-2025.
                    <span className="ml-2 inline-flex items-center gap-1">
                      <span className="inline-block w-3 h-3 rounded bg-green-100"></span> &gt;90%
                      <span className="inline-block w-3 h-3 rounded bg-yellow-100 ml-2"></span> 50-90%
                      <span className="inline-block w-3 h-3 rounded bg-red-100 ml-2"></span> &lt;50%
                    </span>
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
                          Miasto
                        </th>
                        {coverageData.years
                          .filter(y => y >= 2015 && y <= 2025)
                          .sort((a, b) => b - a)
                          .map(year => (
                            <th key={year} scope="col" className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                              {year}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {coverageData.cities.map((city, idx) => (
                        <tr key={city.name} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0" style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}>
                            {city.name}
                          </td>
                          {coverageData.years
                            .filter(y => y >= 2015 && y <= 2025)
                            .sort((a, b) => b - a)
                            .map(year => {
                              const coverage = city.coverage[year];
                              if (!coverage) {
                                return (
                                  <td key={year} className="px-3 py-2 text-center text-xs text-gray-300">
                                    —
                                  </td>
                                );
                              }
                              const { days, pct } = coverage;
                              let bgColor = 'bg-gray-100 text-gray-400';
                              if (pct >= 90) {
                                bgColor = 'bg-green-100 text-green-800';
                              } else if (pct >= 50) {
                                bgColor = 'bg-yellow-100 text-yellow-800';
                              } else if (pct > 0) {
                                bgColor = 'bg-red-100 text-red-800';
                              }
                              return (
                                <td key={year} className={`px-3 py-2 text-center text-xs ${bgColor}`}>
                                  <div className="font-semibold">{days}</div>
                                  <div className="text-[10px] opacity-75">{pct}%</div>
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {coverageLoading && (
              <div className="h-32 flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-200">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin mb-2" />
                <p className="text-sm text-gray-500">Ładowanie danych kompletności...</p>
              </div>
            )}
          </>
        )}

        {/* Data Note */}
        <div className="text-xs text-gray-400 text-center">
          Dane historyczne są agregowane i cache'owane. Rok bieżący jest przeliczany raz na dobę.
        </div>


      </main>
    </div>
  );
}

