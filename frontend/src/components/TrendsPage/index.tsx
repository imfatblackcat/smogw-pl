import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, LineChart as LineChartIcon, Loader2, Info, TrendingDown, TrendingUp, Minus, Table as TableIcon } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { fetchTrends, type RankingMethod, type RankingStandard, type TrendsResponse } from '@/services/api';

const POLLUTANTS = [
  { code: 'PM10', label: 'PM10' },
  { code: 'PM2.5', label: 'PM2.5' },
] as const;

const STANDARDS = [
  { value: 'who', label: 'WHO (Rekomendacja)', desc: 'PM10 > 45, PM2.5 > 15' },
  { value: 'eu', label: 'UE (Dyrektywa 2030)', desc: 'PM10 > 45, PM2.5 > 25' },
] as const;

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

interface CityChangeRow {
  city: string;
  currentYear: number;
  currentValue: number | undefined;
  yoyChange: number | null;
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
  const [standard, setStandard] = useState<RankingStandard>('who');
  const [method, setMethod] = useState<RankingMethod>('city_avg');

  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidden series (controlled by legend click)
  const [hiddenCities, setHiddenCities] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchTrends({ pollutant, standard, method });
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
  }, [pollutant, standard, method]);

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
  const changeTableData = useMemo((): { rows: CityChangeRow[], years: { current: number, yoy: number, y3: number, y5: number, y10: number, oldest: number } | null } => {
    if (!data || data.years.length < 2) return { rows: [], years: null };

    const sortedYears = [...data.years].sort((a, b) => b - a);
    const currentYear = sortedYears[0];
    const prevYear = sortedYears[1];
    const year3 = sortedYears.find(y => y <= currentYear - 3);
    const year5 = sortedYears.find(y => y <= currentYear - 5);
    const year10 = sortedYears.find(y => y <= currentYear - 10);
    const oldestYear = sortedYears[sortedYears.length - 1];

    // Build lookup: year -> { city: value }
    const yearData: Record<number, Record<string, number>> = {};
    for (const point of data.points) {
      yearData[point.year] = {};
      for (const city of data.cities) {
        if (point[city] !== undefined) {
          yearData[point.year][city] = point[city] as number;
        }
      }
    }

    const rows: CityChangeRow[] = data.cities.map(city => {
      const currentValue = yearData[currentYear]?.[city];
      const prevValue = yearData[prevYear]?.[city];
      const value3y = year3 ? yearData[year3]?.[city] : undefined;
      const value5y = year5 ? yearData[year5]?.[city] : undefined;
      const value10y = year10 ? yearData[year10]?.[city] : undefined;
      const oldestValue = yearData[oldestYear]?.[city];

      const yoyChange = calcChange(currentValue, prevValue);
      const change3y = calcChange(currentValue, value3y);
      const change5y = calcChange(currentValue, value5y);
      const change10y = calcChange(currentValue, value10y);
      const oldestChange = oldestYear !== currentYear ? calcChange(currentValue, oldestValue) : null;

      // Sort by YoY change (most negative = biggest improvement first), null last
      const sortValue = yoyChange !== null ? yoyChange : 9999;

      return {
        city,
        currentYear,
        currentValue,
        yoyChange,
        change3y,
        change5y,
        change10y,
        oldestChange,
        oldestYear: oldestYear !== currentYear ? oldestYear : null,
        sortValue,
      };
    });

    // Sort by greatest improvement (most negative YoY first)
    rows.sort((a, b) => a.sortValue - b.sortValue);

    return {
      rows,
      years: {
        current: currentYear,
        yoy: prevYear,
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

    const avgYoy = validRows.filter(r => r.yoyChange !== null);
    const avgYoyVal = avgYoy.length > 0 ? Math.round(avgYoy.reduce((sum, r) => sum + r.yoyChange!, 0) / avgYoy.length) : null;

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
      avgYoy: avgYoyVal,
      avg3y: avg3yVal,
      avg5y: avg5yVal,
      avg10y: avg10yVal,
      avgOldest: avgOldestVal,
    };
  }, [changeTableData]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg text-white">
              <LineChartIcon className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Trendy Wieloletnie</h1>
              <p className="text-sm text-gray-500 mt-1">
                Liczba dni z przekroczeniem norm jakości powietrza (15 lat)
              </p>
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
            </div>

            {/* Standard Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Norma odniesienia</label>
              <select
                value={standard}
                onChange={(e) => setStandard(e.target.value as RankingStandard)}
                className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2.5"
              >
                {STANDARDS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {STANDARDS.find(s => s.value === standard)?.desc} µg/m³ (średnia dobowa)
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
                {standard === 'who' && pollutant === 'PM2.5' && (
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

                    {/* EU limit reference line */}
                    {standard === 'eu' && (
                      <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'right', value: 'Limit UE (35 dni)', fill: '#ef4444', fontSize: 10 }} />
                    )}

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
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
                          Miasto
                        </th>
                        <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {changeTableData.years.current}<br /><span className="normal-case font-normal">(dni)</span>
                        </th>
                        <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          vs {changeTableData.years.yoy}<br /><span className="normal-case font-normal">(YoY)</span>
                        </th>
                        {changeTableData.years.y3 > 0 && (
                          <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            vs {changeTableData.years.y3}<br /><span className="normal-case font-normal">(3 lata)</span>
                          </th>
                        )}
                        {changeTableData.years.y5 > 0 && (
                          <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            vs {changeTableData.years.y5}<br /><span className="normal-case font-normal">(5 lat)</span>
                          </th>
                        )}
                        {changeTableData.years.y10 > 0 && (
                          <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            vs {changeTableData.years.y10}<br /><span className="normal-case font-normal">(10 lat)</span>
                          </th>
                        )}
                        {changeTableData.years.oldest !== changeTableData.years.current && (
                          <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            vs {changeTableData.years.oldest}<br /><span className="normal-case font-normal">(najstarszy)</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {changeTableData.rows.map((row, idx) => (
                        <tr key={row.city} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0" style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}>
                            {row.city}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center text-gray-900 font-semibold">
                            {row.currentValue !== undefined ? row.currentValue : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                            <ChangeCell value={row.yoyChange} />
                          </td>
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
                          {changeTableData.years && changeTableData.years.oldest !== changeTableData.years.current && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={row.oldestChange} />
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
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                            <ChangeCell value={avgRow.avgYoy} />
                          </td>
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
                          {changeTableData.years.oldest !== changeTableData.years.current && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                              <ChangeCell value={avgRow.avgOldest} />
                            </td>
                          )}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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

