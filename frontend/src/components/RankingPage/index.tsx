import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Loader2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  fetchRanking,
  fetchRankingYears,
  type RankingMethod,
  type RankingResponse,
} from '@/services/api';

const POLLUTANTS = [
  { code: 'PM10', label: 'PM10' },
  { code: 'PM2.5', label: 'PM2.5' },
] as const;

type PollutantCode = (typeof POLLUTANTS)[number]['code'];

const METHODS: Array<{ value: RankingMethod; label: string; description: string }> = [
  {
    value: 'city_avg',
    label: 'Średnia miasta',
    description: 'Dzień przekroczony, jeśli średnia dobowa (średnia z dobowych średnich stacji) > limit',
  },
  {
    value: 'worst_station',
    label: 'Najgorsza stacja',
    description: 'Dzień przekroczony, jeśli najgorsza stacja w mieście > limit',
  },
  {
    value: 'any_station_exceed',
    label: 'Dowolna stacja przekroczyła',
    description: 'Dzień przekroczony, jeśli jakakolwiek stacja w mieście > limit',
  },
];

function formatDateTime(value: string) {
  // computed_at may be ISO or SQLite timestamp
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('pl-PL');
    }
  } catch {
    // ignore
  }
  return value;
}

export function RankingPage() {
  const [pollutant, setPollutant] = useState<PollutantCode>('PM10');
  const [method, setMethod] = useState<RankingMethod>('city_avg');

  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);

  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadYears() {
      setError(null);
      setRanking(null);
      setYears([]);
      setYear(null);

      try {
        const resp = await fetchRankingYears(pollutant);
        if (cancelled) return;

        setYears(resp.years);
        setYear(resp.years[0] ?? null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Nie udało się pobrać listy lat.');
      }
    }

    loadYears();
    return () => {
      cancelled = true;
    };
  }, [pollutant]);

  useEffect(() => {
    if (year == null) return;

    let cancelled = false;

    async function loadRanking() {
      setLoading(true);
      setError(null);

      try {
        const resp = await fetchRanking({ year, pollutant, method });
        if (cancelled) return;
        setRanking(resp);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Nie udało się pobrać rankingu.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRanking();
    return () => {
      cancelled = true;
    };
  }, [year, pollutant, method]);

  const chartData = useMemo(() => {
    if (!ranking) return [];
    return ranking.cities.slice(0, 20).map((c) => ({
      city: c.city,
      exceedance_days: c.exceedance_days,
      exceedance_pct: c.exceedance_pct,
    }));
  }, [ranking]);

  const methodInfo = METHODS.find((m) => m.value === method);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 rounded-xl">
              <BarChart3 className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Ranking miast</h1>
              <p className="text-blue-100 mt-1">
                Liczba dni z przekroczeniem limitu dobowego UE (2024/2881)
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Zanieczyszczenie</label>
              <select
                className="mt-1 block w-full rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                value={pollutant}
                onChange={(e) => setPollutant(e.target.value as PollutantCode)}
              >
                {POLLUTANTS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Rok</label>
              <select
                className="mt-1 block w-full rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                value={year ?? ''}
                onChange={(e) => setYear(Number(e.target.value))}
                disabled={years.length === 0}
              >
                {years.length === 0 ? (
                  <option value="">Brak danych</option>
                ) : (
                  years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Metoda miasta</label>
              <select
                className="mt-1 block w-full rounded-lg border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                value={method}
                onChange={(e) => setMethod(e.target.value as RankingMethod)}
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {methodInfo && (
                <p className="mt-2 text-xs text-gray-500">{methodInfo.description}</p>
              )}
            </div>
          </div>

          {ranking && (
            <div className="mt-4 text-sm text-gray-600">
              <p>
                Limit dobowy ({pollutant}): <span className="font-semibold">{ranking.threshold_value} μg/m³</span>.
                Dopuszczalne przekroczenia: <span className="font-semibold">{ranking.allowed_exceedances_per_year}</span> dni/rok.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Dane liczymy z cache (SQLite). Dzień stacji jest ważny, jeśli ma ≥ 18 wartości godzinowych.
                Ostatnie przeliczenie: {formatDateTime(ranking.computed_at)}.
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
            <p className="mt-3 text-gray-600">Liczenie / pobieranie rankingu...</p>
          </div>
        )}

        {/* Chart */}
        {!loading && ranking && ranking.cities.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Top 20 (dni z przekroczeniem)</h2>
              <span className="text-sm text-gray-500">Miast: {ranking.total_cities}</span>
            </div>

            <div className="mt-4" style={{ height: 520 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 40, right: 24 }}>
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="city"
                    width={140}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value: any, name: any, props: any) => {
                      if (name === 'exceedance_days') return [`${value} dni`, 'Przekroczenia'];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="exceedance_days" fill="#2563eb" radius={[6, 6, 6, 6]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Table */}
        {!loading && ranking && ranking.cities.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900">Pełny ranking</h2>
              <p className="text-sm text-gray-500 mt-1">
                Sortowanie: liczba dni z przekroczeniem (malejąco). W nawiasie: % dni z danymi.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Miasto</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dni przekroczeń</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dni z danymi</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Śr. dobowa</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Max dobowa</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Stacje (rok)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Limit 18</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {ranking.cities.map((c) => (
                    <tr key={c.city}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{c.rank}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{c.city}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{c.exceedance_days}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{c.days_with_data}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{c.exceedance_pct.toFixed(2)}%</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{c.avg_city_day_value.toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{c.max_city_day_value.toFixed(2)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">{c.stations_count}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {c.exceeds_allowed_exceedances ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            przekroczony
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && ranking && ranking.cities.length === 0 && !error && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="mt-4 text-gray-600">Brak danych do wyświetlenia dla wybranego roku.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default RankingPage;
