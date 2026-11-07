'use server';

import { dailyQuoteFromChart, normalizeYahooSymbol, type YahooDailyQuote } from '@/lib/yahoo';

// Daily quotes from Yahoo Finance (free, no key), keyed by the symbol passed in.
// One chart call per symbol behind a shared 5-minute cache.
export async function getYahooDailyQuotes(symbols: string[]): Promise<Record<string, YahooDailyQuote>> {
    const entries = await Promise.all(
        symbols.map(async (symbol) => {
            const yahooSymbol = normalizeYahooSymbol(symbol);
            if (!yahooSymbol) return [symbol, null] as const;
            try {
                const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    next: { revalidate: 300 },
                });
                if (!res.ok) return [symbol, null] as const;
                return [symbol, dailyQuoteFromChart(await res.json())] as const;
            } catch (e) {
                console.error('Yahoo daily quote error', symbol, e);
                return [symbol, null] as const;
            }
        }),
    );
    return Object.fromEntries(entries.filter(([, q]) => q)) as Record<string, YahooDailyQuote>;
}

export type YahooChartPoint = {
    date: string;
    timestamp: number;
    close: number;
    open: number;
    high: number;
    low: number;
    volume: number;
};

export type YahooHistoricalChartData = {
    symbol: string;
    currency: string;
    points: YahooChartPoint[];
    previousClose: number;
    currentPrice: number;
    change: number;
    changePercent: number;
};

export async function getYahooHistoricalChart(
    symbol: string,
    range: '1mo' | '3mo' | '1y' | '5y' = '3mo',
): Promise<YahooHistoricalChartData | null> {
    const yahooSymbol = normalizeYahooSymbol(symbol);
    if (!yahooSymbol) return null;

    try {
        const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${range}`,
            {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 300 },
            },
        );
        if (!res.ok) return null;
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) return null;

        const meta = result.meta;
        const timestamps: number[] = result.timestamp ?? [];
        const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
        const opens: (number | null)[] = result.indicators?.quote?.[0]?.open ?? [];
        const highs: (number | null)[] = result.indicators?.quote?.[0]?.high ?? [];
        const lows: (number | null)[] = result.indicators?.quote?.[0]?.low ?? [];
        const volumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

        const points: YahooChartPoint[] = [];
        for (let i = 0; i < timestamps.length; i++) {
            const c = closes[i];
            if (c != null && Number.isFinite(c)) {
                const ts = timestamps[i] * 1000;
                const d = new Date(ts);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                points.push({
                    date: dateStr,
                    timestamp: ts,
                    close: c,
                    open: opens[i] ?? c,
                    high: highs[i] ?? c,
                    low: lows[i] ?? c,
                    volume: volumes[i] ?? 0,
                });
            }
        }

        if (points.length === 0) return null;

        const currentPrice = meta?.regularMarketPrice ?? points[points.length - 1].close;
        const firstPrice = points[0].close;
        const change = currentPrice - firstPrice;
        const changePercent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;

        return {
            symbol,
            currency: meta?.currency || 'USD',
            points,
            previousClose: meta?.chartPreviousClose ?? firstPrice,
            currentPrice,
            change,
            changePercent,
        };
    } catch (e) {
        console.error('Yahoo historical chart error', symbol, e);
        return null;
    }
}
