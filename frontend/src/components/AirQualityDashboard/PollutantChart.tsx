import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { Eye, EyeOff } from 'lucide-react';
import type { Pollutant, DataPoint, ChartSeries, ChartDataPoint } from './types';

import type { AggregationType } from './types';

// Normy jakości powietrza wg Dyrektywy UE 2008/50/WE (implementacja w polskim prawie)
// Źródło: Rozporządzenie Ministra Środowiska, GIOŚ
// Każda norma ma przypisane typy agregacji, dla których ma sens jej wyświetlanie
type LimitDef = {
  value: number;
  label: string;
  description: string;
  applicableAggregations: AggregationType[];
};

const POLLUTANT_LIMITS: Record<string, LimitDef> = {
  'PM10': {
    value: 50,
    label: 'Norma dobowa UE',
    description: 'Poziom dopuszczalny: 50 µg/m³ (średnia dobowa, max 35 przekroczeń/rok) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['daily'],
  },
  'PM2.5': {
    value: 25,
    label: 'Norma dobowa UE',
    description: 'Poziom dopuszczalny: 25 µg/m³ (średnia dobowa) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['daily'],
  },
  'NO2': {
    value: 200,
    label: 'Norma 1h UE',
    description: 'Poziom dopuszczalny: 200 µg/m³ (średnia 1-godzinowa, max 18 przekroczeń/rok) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['hourly'],
  },
  'SO2': {
    value: 350,
    label: 'Norma 1h UE',
    description: 'Poziom dopuszczalny: 350 µg/m³ (średnia 1-godzinowa, max 24 przekroczenia/rok) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['hourly'],
  },
  'O3': {
    value: 120,
    label: 'Poziom docelowy UE',
    description: 'Poziom docelowy: 120 µg/m³ (max średnia 8-godzinna) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['hourly', 'daily'], // 8h mieści się między godzinową a dobową
  },
  'CO': {
    value: 10000,
    label: 'Norma 8h UE',
    description: 'Poziom dopuszczalny: 10 000 µg/m³ (max średnia krocząca 8h) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['hourly', 'daily'], // 8h mieści się między godzinową a dobową
  },
  'C6H6': {
    value: 5,
    label: 'Norma roczna UE',
    description: 'Poziom dopuszczalny: 5 µg/m³ (średnia roczna) - Dyrektywa UE 2008/50/WE',
    applicableAggregations: ['monthly'], // miesięczna agregacja jako przybliżenie rocznej
  },
};

// Funkcja sprawdzająca czy norma powinna być wyświetlana dla danej agregacji
function getLimitForAggregation(
  pollutantCode: string,
  aggregation: AggregationType
): LimitDef | null {
  const limit = POLLUTANT_LIMITS[pollutantCode];
  if (!limit) return null;
  if (!limit.applicableAggregations.includes(aggregation)) return null;
  return limit;
}

// Color palette for chart lines
const COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#6366F1', // indigo
  '#14B8A6', // teal
];

interface PollutantChartProps {
  pollutant: Pollutant;
  data: DataPoint[];
  showAverage: boolean;
  stationIdToCity: Map<string, string>;
  aggregation: AggregationType;
}

export function PollutantChart({
  pollutant,
  data,
  showAverage,
  stationIdToCity,
  aggregation,
}: PollutantChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  // Build series based on showAverage toggle
  const { chartData, series } = useMemo(() => {
    if (data.length === 0) {
      return { chartData: [], series: [] };
    }

    // Group data points
    const groupedData: Record<string, DataPoint[]> = {};
    
    if (showAverage) {
      // Group by city - calculate average of selected stations per city
      for (const point of data) {
        const cityName = point.city;
        if (!groupedData[cityName]) {
          groupedData[cityName] = [];
        }
        groupedData[cityName].push(point);
      }
    } else {
      // Group by station
      for (const point of data) {
        const key = point.station_name || point.city;
        if (!groupedData[key]) {
          groupedData[key] = [];
        }
        groupedData[key].push(point);
      }
    }

    // Get all unique timestamps
    const timestamps = [...new Set(data.map((d) => d.timestamp))].sort();

    // Build chart data
    const chartData: ChartDataPoint[] = timestamps.map((timestamp) => {
      const point: ChartDataPoint = { timestamp };

      if (showAverage) {
        // Calculate average for each city at this timestamp
        for (const [cityName, cityData] of Object.entries(groupedData)) {
          const values = cityData
            .filter((d) => d.timestamp === timestamp && d.value !== null)
            .map((d) => d.value as number);
          
          if (values.length > 0) {
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            point[`${cityName} (średnia)`] = Math.round(avg * 100) / 100;
          }
        }
      } else {
        // Individual station values
        for (const [key, keyData] of Object.entries(groupedData)) {
          const dataPoint = keyData.find((d) => d.timestamp === timestamp);
          if (dataPoint?.value !== null && dataPoint?.value !== undefined) {
            point[key] = dataPoint.value;
          }
        }
      }

      return point;
    });

    // Build series info
    const seriesKeys = showAverage
      ? Object.keys(groupedData).map((city) => `${city} (średnia)`)
      : Object.keys(groupedData);

    const series: ChartSeries[] = seriesKeys.map((key, index) => {
      const cityName = showAverage
        ? key.replace(' (średnia)', '')
        : stationIdToCity.get(
            data.find((d) => d.station_name === key)?.station_id?.toString() || ''
          ) || key;

      return {
        key,
        label: key,
        color: COLORS[index % COLORS.length],
        visible: !hiddenSeries.has(key),
        cityName,
      };
    });

    return { chartData, series };
  }, [data, showAverage, stationIdToCity, hiddenSeries]);

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const formatXAxis = (timestamp: string) => {
    try {
      if (timestamp.includes('W')) {
        return timestamp;
      } else if (timestamp.length === 7) {
        return timestamp;
      } else if (timestamp.length === 10) {
        return format(parseISO(timestamp), 'dd.MM');
      } else {
        return format(parseISO(timestamp.replace(' ', 'T')), 'dd.MM HH:mm');
      }
    } catch {
      return timestamp;
    }
  };

  const limit = getLimitForAggregation(pollutant.code, aggregation);

  if (data.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          {pollutant.name}
        </h3>
        <p className="text-sm text-gray-500">
          {pollutant.code} • {pollutant.unit}
        </p>
        {limit && (
          <p className="text-xs text-amber-600 mt-1">
            {limit.description}
          </p>
        )}
      </div>

      {/* Chart */}
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              tick={{ fill: '#6B7280', fontSize: 12 }}
              axisLine={{ stroke: '#E5E7EB' }}
              tickLine={{ stroke: '#E5E7EB' }}
            />
            <YAxis
              tick={{ fill: '#6B7280', fontSize: 12 }}
              axisLine={{ stroke: '#E5E7EB' }}
              tickLine={{ stroke: '#E5E7EB' }}
              label={{
                value: pollutant.unit,
                angle: -90,
                position: 'insideLeft',
                fill: '#6B7280',
                fontSize: 12,
              }}
            />
            <Tooltip
              labelFormatter={formatXAxis}
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
              formatter={(value: number, name: string) => [
                `${value?.toFixed(2)} ${pollutant.unit}`,
                name,
              ]}
            />
            {limit && (
              <ReferenceLine
                y={limit.value}
                stroke="#DC2626"
                strokeDasharray="6 4"
                strokeWidth={2}
                label={{
                  value: `${limit.label}: ${limit.value} ${pollutant.unit}`,
                  position: 'right',
                  fill: '#DC2626',
                  fontSize: 11,
                  fontWeight: 500,
                }}
              />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                strokeOpacity={s.visible ? 1 : 0}
                name={s.label}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Interactive Legend */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => toggleSeries(s.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all ${
                s.visible
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: s.color,
                  opacity: s.visible ? 1 : 0.3,
                }}
              />
              <span className={s.visible ? '' : 'line-through'}>{s.label}</span>
              {s.visible ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
