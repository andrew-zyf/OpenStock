'use client';

import { useEffect, useRef } from 'react';
import { useMarketResource } from '@/hooks/useMarketResource';
import { isRealtime } from '@/lib/market-data';
import { QUOTE_REFRESH_MS } from '@/lib/market/refresh';

export type LiveQuote = {
    c?: number; d?: number; dp?: number; h?: number; l?: number; o?: number; pc?: number; t?: number;
    priceBasis?: 'last-trade' | 'previous-close';
    currency?: string; volume?: number; turnover?: number; turnoverRate?: number; marketCap?: number;
    pe?: number; pb?: number; source?: string; asOf?: string; fetchedAt?: string; stale?: boolean;
};
export type LiveQuoteMap = Record<string, LiveQuote | null>;

export function mergeQuoteSnapshot(symbols: string[], data: LiveQuoteMap, previous: LiveQuoteMap): LiveQuoteMap {
    return Object.fromEntries(symbols.map((symbol) => [symbol,
        data[symbol] ? { ...data[symbol], stale: false }
            : previous[symbol] ? { ...previous[symbol], stale: true } : null,
    ]));
}

export function useLiveQuoteResource(symbols: string[], intervalMs = QUOTE_REFRESH_MS.realtime, initialData?: LiveQuoteMap) {
    const key = [...new Set(symbols)].join(',');
    const previous = useRef({ key, data: initialData ?? {} });
    const resource = useMarketResource<LiveQuoteMap>({
        key: `quotes:${key}`, enabled: Boolean(key), initialData,
        intervalMs: isRealtime ? intervalMs : QUOTE_REFRESH_MS.cached,
        loader: async () => {
            const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`);
            if (!response.ok) throw new Error(`行情请求失败 (${response.status})`);
            const data: LiveQuoteMap = await response.json();
            if (!Object.values(data).some((quote) => quote != null)) throw new Error('行情暂不可用');
            const prior = previous.current.key === key ? previous.current.data : initialData ?? {};
            return mergeQuoteSnapshot(key.split(','), data, prior);
        },
    });
    useEffect(() => { previous.current = { key, data: resource.data ?? {} }; }, [key, resource.data]);
    return { ...resource, stale: resource.stale || Object.values(resource.data ?? {}).some((quote) => quote?.stale) };
}

// Preserve the public map contract used by existing price displays.
export function useLiveQuotes(symbols: string[], intervalMs = QUOTE_REFRESH_MS.realtime) {
    return useLiveQuoteResource(symbols, intervalMs).data ?? {};
}
