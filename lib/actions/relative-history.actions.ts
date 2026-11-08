'use server';

import { getUnifiedChartSeries } from '@/lib/actions/realtime-market.actions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { compareRelativeHistory, relativeHistoryUnavailableReason, type RelativeHistoryComparison } from '@/lib/market/relative-history';

/** Exactly two targeted daily-history requests, in parallel; the adapter also bounds each upstream. */
export async function getRelativeHistoryComparison(symbol: string, benchmarkSymbol: string, currency?: string): Promise<RelativeHistoryComparison> {
    const reason = relativeHistoryUnavailableReason(symbol, benchmarkSymbol, currency);
    if (reason) return { status: 'unavailable', reason };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const [stock, benchmark] = await Promise.race([
            Promise.all([
                getUnifiedChartSeries(identifyMarketAndCode(symbol).normalizedSymbol, '1m'),
                getUnifiedChartSeries(identifyMarketAndCode(benchmarkSymbol).normalizedSymbol, '1m'),
            ]),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('历史来源请求超时，请稍后重试')), 7_000);
            }),
        ]);
        // Throw on refresh failure so useMarketResource retains its last successful snapshot.
        if (!stock || !benchmark) throw new Error('标的或基准历史来源暂不可用，请稍后重试');
        return compareRelativeHistory(symbol, stock, benchmarkSymbol, benchmark, currency);
    } finally {
        clearTimeout(timer);
    }
}
