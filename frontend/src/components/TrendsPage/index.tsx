import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, LineChart as LineChartIcon, Loader2, Info } from 'lucide-react';
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
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                      pollutant === p.code
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
                  
                  {/* Threshold line reference? No, the chart value IS the count of days. 
                      Maybe a reference line for allowed exceedances? */}
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
        )}
        
        {/* Data Note */}
        <div className="text-xs text-gray-400 text-center">
           Dane historyczne są agregowane i cache'owane. Rok bieżący jest przeliczany raz na dobę.
        </div>

      </main>
    </div>
  );
}
