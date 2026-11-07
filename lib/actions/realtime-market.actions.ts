'use server';

import {
    fetchRealtimeQuotes,
    fetchUnifiedChartSeries,
    type UnifiedQuote,
    type ChartSeries,
    type ChartPeriod,
} from "@/lib/realtime-market";

export async function getRealtimeQuote(symbol: string): Promise<UnifiedQuote | null> {
    const map = await fetchRealtimeQuotes([symbol]);
    return map[symbol] ?? null;
}

export async function getRealtimeQuotesBatch(symbols: string[]): Promise<Record<string, UnifiedQuote | null>> {
    return await fetchRealtimeQuotes(symbols);
}

export async function getUnifiedChartSeries(
    symbol: string,
    period: ChartPeriod = '1d',
): Promise<ChartSeries | null> {
    return await fetchUnifiedChartSeries(symbol, period);
}
