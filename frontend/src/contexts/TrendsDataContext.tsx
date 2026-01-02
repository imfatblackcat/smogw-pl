import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from 'react';
import { fetchTrends, fetchDataCoverage, type TrendsResponse, type DataCoverageResponse, type RankingMethod } from '@/services/api';

type CacheKey = `${string}-${RankingMethod}`;

interface TrendsDataContextType {
    getTrends: (pollutant: string, method: RankingMethod) => TrendsResponse | null;
    getCoverage: (pollutant: string) => DataCoverageResponse | null;
    isLoading: boolean;
    prefetchAll: () => Promise<void>;
}

const TrendsDataContext = createContext<TrendsDataContextType | null>(null);

export function TrendsDataProvider({ children }: { children: ReactNode }) {
    const [trendsCache, setTrendsCache] = useState<Map<CacheKey, TrendsResponse>>(new Map());
    const [coverageCache, setCoverageCache] = useState<Map<string, DataCoverageResponse>>(new Map());
    const [isLoading, setIsLoading] = useState(true);

    const prefetchAll = useCallback(async () => {
        setIsLoading(true);

        const pollutants = ['PM10', 'PM2.5'] as const;
        const methods: RankingMethod[] = ['city_avg', 'worst_station'];

        try {
            // Fetch all trends combinations in parallel
            const trendsPromises = pollutants.flatMap(pollutant =>
                methods.map(async method => {
                    const key: CacheKey = `${pollutant}-${method}`;
                    const data = await fetchTrends({ pollutant, standard: 'who', method });
                    return { key, data };
                })
            );

            // Fetch coverage for both pollutants
            const coveragePromises = pollutants.map(async pollutant => {
                const data = await fetchDataCoverage(pollutant);
                return { pollutant, data };
            });

            const [trendsResults, coverageResults] = await Promise.all([
                Promise.all(trendsPromises),
                Promise.all(coveragePromises),
            ]);

            // Update caches
            const newTrendsCache = new Map<CacheKey, TrendsResponse>();
            for (const { key, data } of trendsResults) {
                newTrendsCache.set(key, data);
            }
            setTrendsCache(newTrendsCache);

            const newCoverageCache = new Map<string, DataCoverageResponse>();
            for (const { pollutant, data } of coverageResults) {
                newCoverageCache.set(pollutant, data);
            }
            setCoverageCache(newCoverageCache);

            console.log('[TrendsData] Prefetched all data');
        } catch (error) {
            console.error('[TrendsData] Prefetch error:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Prefetch on mount
    useEffect(() => {
        prefetchAll();
    }, [prefetchAll]);

    const getTrends = useCallback((pollutant: string, method: RankingMethod): TrendsResponse | null => {
        const key: CacheKey = `${pollutant}-${method}`;
        return trendsCache.get(key) || null;
    }, [trendsCache]);

    const getCoverage = useCallback((pollutant: string): DataCoverageResponse | null => {
        return coverageCache.get(pollutant) || null;
    }, [coverageCache]);

    const value = useMemo(() => ({
        getTrends,
        getCoverage,
        isLoading,
        prefetchAll,
    }), [getTrends, getCoverage, isLoading, prefetchAll]);

    return (
        <TrendsDataContext.Provider value={value}>
            {children}
        </TrendsDataContext.Provider>
    );
}

export function useTrendsData() {
    const context = useContext(TrendsDataContext);
    if (!context) {
        throw new Error('useTrendsData must be used within TrendsDataProvider');
    }
    return context;
}
