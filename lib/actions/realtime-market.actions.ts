'use server';

import {
    fetchRealtimeQuotes,
    fetchUnifiedChartSeries,
    fetchLevel1OrderBook,
    fetchCapitalFlow,
    type UnifiedQuote,
    type ChartSeries,
    type ChartPeriod,
    type Level1OrderBook,
    type CapitalFlowData,
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

export async function getLevel1OrderBook(symbol: string): Promise<Level1OrderBook | null> {
    return await fetchLevel1OrderBook(symbol);
}

export async function getCapitalFlow(symbol: string): Promise<CapitalFlowData | null> {
    return await fetchCapitalFlow(symbol);
}
