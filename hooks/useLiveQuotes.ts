'use client';

import { useEffect, useRef } from 'react';
import { useMarketResource } from '@/hooks/useMarketResource';
import { isRealtime } from '@/lib/market-data';
import { QUOTE_REFRESH_MS } from '@/lib/market/refresh';

export type LiveQuote = {
    c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number; t?: number;
    priceBasis?: 'last-trade' | 'previous-close';
    currency?: string; volume?: number; turnover?: number; turnoverRate?: number; amplitude?: number; marketCap?: number;
    pe?: number; pb?: number; source?: string; asOf?: string; fetchedAt?: string; stale?: boolean;
};
export type LiveQuoteMap = Record<string, LiveQuote | null>;

export function mergeQuoteSnapshot(symbols: string[], data: LiveQuoteMap, previous: LiveQuoteMap): LiveQuoteMap {
    return Object.fromEntries(symbols.map((symbol) => [symbol,
        data[symbol] ? { ...data[symbol], stale: false }
            : previous[symbol] ? { ...previous[symbol], stale: true } : null,
    ]));
}

// The endpoint accepts 25 symbols. Keep at most two requests in flight, including benchmarks.
export async function fetchQuoteBatches(symbols: string[], previous: LiveQuoteMap = {}): Promise<LiveQuoteMap> {
    const unique = [...new Set(symbols)];
    const batches: string[][] = [];
    for (let index = 0; index < unique.length; index += 25) batches.push(unique.slice(index, index + 25));
    const data: LiveQuoteMap = {};
    let next = 0;
    async function worker() {
        while (next < batches.length) {
            const batch = batches[next++];
            try {
                const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(batch.join(','))}`);
                if (!response.ok) continue;
                const quotes: LiveQuoteMap = await response.json();
                for (const symbol of batch) data[symbol] = quotes[symbol] ?? null;
            } catch {
                // Other batches may still succeed; absent symbols retain their own last good quote.
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, worker));
    if (!Object.values(data).some((quote) => quote != null)) throw new Error('行情暂不可用');
    return mergeQuoteSnapshot(unique, data, previous);
}

export function useLiveQuoteResource(symbols: string[], intervalMs = QUOTE_REFRESH_MS.realtime, initialData?: LiveQuoteMap) {
    const key = [...new Set(symbols)].join(',');
    const previous = useRef({ key, data: initialData ?? {} });
    const resource = useMarketResource<LiveQuoteMap>({
        key: `quotes:${key}`, enabled: Boolean(key), initialData,
        intervalMs: isRealtime ? intervalMs : QUOTE_REFRESH_MS.cached,
        loader: async () => {
            const prior = previous.current.key === key ? previous.current.data : initialData ?? {};
            return fetchQuoteBatches(key.split(','), prior);
        },
    });
    useEffect(() => { previous.current = { key, data: resource.data ?? {} }; }, [key, resource.data]);
    return { ...resource, stale: resource.stale || Object.values(resource.data ?? {}).some((quote) => quote?.stale) };
}

// Preserve the public map contract used by existing price displays.
export function useLiveQuotes(symbols: string[], intervalMs = QUOTE_REFRESH_MS.realtime) {
    return useLiveQuoteResource(symbols, intervalMs).data ?? {};
}
