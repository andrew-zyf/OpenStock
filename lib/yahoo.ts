// Yahoo Finance helpers for international quotes (.HK, .TW, .SR, etc.), which TradingView's free embeds and Finnhub's free plan don't price or block.
// Pure functions, covered by tests; the network call lives in lib/actions/yahoo.actions.ts.

// Normalizes international tickers into Yahoo Finance symbols (e.g. "400.HK" -> "0400.HK", "2330.TW" -> "2330.TW", "2222.SR" -> "2222.SR").
// Bare numbers and plain US tickers without exchange context return null.
export function normalizeYahooSymbol(symbol: string): string | null {
    const upper = (symbol || '').trim().toUpperCase();
    if (!upper) return null;

    // Tadawul index & stocks
    if (upper === 'TADAWUL:TASI' || upper === '^TASI.SR') return '^TASI.SR';
    if (/^\d+\.SR$/.test(upper)) return upper;
    if (upper.startsWith('TADAWUL:')) {
        const ticker = upper.slice('TADAWUL:'.length);
        return /^\d+$/.test(ticker) ? `${ticker}.SR` : null;
    }

    // Hong Kong (.HK / HKEX:) - Yahoo Finance requires 4-digit zero-padded ticker (e.g. 0400.HK, 0700.HK)
    if (upper.endsWith('.HK')) {
        const code = upper.slice(0, -3);
        if (/^\d+$/.test(code)) return `${code.padStart(4, '0')}.HK`;
        return upper;
    }
    if (upper.startsWith('HKEX:')) {
        const code = upper.slice(5);
        if (/^\d+$/.test(code)) return `${code.padStart(4, '0')}.HK`;
        return `${code}.HK`;
    }

    // Taiwan (.TW / TWSE:) & Taipei OTC (.TWO / TPEX:)
    if (upper.endsWith('.TW') || upper.endsWith('.TWO')) return upper;
    if (upper.startsWith('TWSE:')) return `${upper.slice(5)}.TW`;
    if (upper.startsWith('TPEX:')) return `${upper.slice(5)}.TWO`;

    // Shanghai (.SS / SSE:) & Shenzhen (.SZ / SZSE:)
    if (upper.endsWith('.SS') || upper.endsWith('.SZ')) return upper;
    if (upper.startsWith('SSE:')) return `${upper.slice(4)}.SS`;
    if (upper.startsWith('SZSE:')) return `${upper.slice(5)}.SZ`;

    // Other international suffix with exchange dot (e.g. .L, .T, .DE, .AX)
    if (/^[A-Z0-9.\-_]+\.[A-Z]{1,4}$/.test(upper)) return upper;

    return null;
}

export const isTadawulSymbol = (symbol: string) => {
    const s = normalizeYahooSymbol(symbol);
    return s !== null && s.endsWith('.SR');
};

export const isYahooPricedSymbol = (symbol: string) => normalizeYahooSymbol(symbol) !== null;

// "TADAWUL:2222" -> "2222.SR", the symbol our stock pages use. The TASI index has no stock page.
export const tadawulAppSymbol = (tvSymbol: string) => {
    const yahoo = normalizeYahooSymbol(tvSymbol);
    return yahoo && !yahoo.startsWith('^') ? yahoo : null;
};

export type YahooDailyQuote = {
    price: number;
    change: number;
    changePercent: number;
    currency: string;
    name: string;
    open?: number;
    dayHigh?: number;
    dayLow?: number;
    prevClose?: number;
    volume?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
};

type YahooChartJson = {
    chart?: {
        result?: Array<{
            meta?: {
                currency?: string;
                shortName?: string;
                longName?: string;
                regularMarketPrice?: number;
                fulldayChange?: number;
                regularMarketChangePercent?: number;
                regularMarketDayHigh?: number;
                regularMarketDayLow?: number;
                chartPreviousClose?: number;
                regularMarketVolume?: number;
                fiftyTwoWeekHigh?: number;
                fiftyTwoWeekLow?: number;
            };
            indicators?: { quote?: Array<{ close?: (number | null)[]; open?: (number | null)[] }> };
        }>;
    };
};

// Today's quote from a /v8/finance/chart response: Yahoo's own day change when it sends one,
// else the last two daily closes (the TASI index only ever returns one daily bar, so it needs the former).
export function dailyQuoteFromChart(json: unknown): YahooDailyQuote | null {
    const result = (json as YahooChartJson)?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((n): n is number => Number.isFinite(n));
    if (!result || closes.length === 0) return null;
    const price = meta?.regularMarketPrice ?? closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : null;
    const change = meta?.fulldayChange ?? (prev != null ? price - prev : 0);
    return {
        price,
        change,
        changePercent: meta?.regularMarketChangePercent ?? (prev ? (change / prev) * 100 : 0),
        currency: result.meta?.currency || 'SAR',
        name: result.meta?.shortName || result.meta?.longName || '',
        open: meta?.chartPreviousClose ?? (result?.indicators?.quote?.[0]?.open?.[0] as number | undefined),
        dayHigh: meta?.regularMarketDayHigh,
        dayLow: meta?.regularMarketDayLow,
        prevClose: meta?.chartPreviousClose ?? (prev ?? undefined),
        volume: meta?.regularMarketVolume,
        fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: meta?.fiftyTwoWeekLow,
    };
}
