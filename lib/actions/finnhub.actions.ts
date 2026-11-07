'use server';

import { getDateRange, validateArticle, formatArticle } from '@/lib/utils';
import { POPULAR_STOCKS } from '@/lib/constants';
import { cache } from 'react';
import { QUOTE_TTL_SECONDS } from '@/lib/market-data';
import { hasFinnhubQuotes } from '@/lib/markets';
import { getYahooDailyQuotes } from '@/lib/actions/yahoo.actions';
import { isTadawulSymbol } from '@/lib/yahoo';
import { getSession } from '@/lib/better-auth/auth';
import { findChineseStocks } from '@/lib/chinese-stocks';
import { fetchRealtimeQuotes } from '@/lib/realtime-market';
import { getMultiMarketNews } from '@/lib/actions/china-market.actions';

const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
// Key pool: each free key has its own 60 req/min, so N keys = N x the quota. Rotated per request.
// Read through an alias: `next build` freezes a literal process.env.NEXT_PUBLIC_* into the bundle, so Docker and
// Railway images (built without secrets) would ignore a NEXT_PUBLIC_FINNHUB_API_KEY set at runtime.
const env = process.env;
const FINNHUB_KEYS = (env.FINNHUB_API_KEYS || env.NEXT_PUBLIC_FINNHUB_API_KEY || env.FINNHUB_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
let nextKeyIndex = 0;
const FETCH_TIMEOUT_MS = 5000;
// Finnhub stalls bursts of parallel requests from one key (measured: 4 at once -> most hang),
// so calls are queued. ponytail: per-instance limiter; a shared queue (Redis) if instances multiply.
const MAX_IN_FLIGHT_PER_KEY = 2;
const MAX_CACHE_ENTRIES = 1000;
const FAILURE_TTL_MS = 60_000;
// Quotes are shared across everyone looking at a symbol: Finnhub cost scales with symbols, not users
const LIVE_QUOTE_TTL = QUOTE_TTL_SECONDS;
// Long-lived responses also go to the Next data cache, which Vercel shares across all instances
const SHARED_CACHE_MIN_TTL = 60;

type FinnhubQuote = {
    c?: number;  // current
    d?: number;  // change
    dp?: number; // change %
    h?: number;  // day high
    l?: number;  // day low
    o?: number;  // open
    pc?: number; // previous close
    t?: number;  // unix time of the last trade
};

type FinnhubStockMetrics = {
    metric?: {
        dividendYieldIndicatedAnnual?: number | null;
    };
};

type FinnhubCompanyProfile = {
    currency?: string;
    exchange?: string;
    logo?: string;
    marketCapitalization?: number;
    name?: string;
    ticker?: string;
    finnhubIndustry?: string;
    weburl?: string;
};

type SearchStockCandidate = FinnhubSearchResult & {
    __exchange?: string;
};

const FINNHUB_EXCHANGE_SUFFIXES = new Set([
    'AS', 'AT', 'AX', 'BA', 'BK', 'BO', 'BR', 'CO', 'DE', 'F', 'HE', 'HK',
    'IL', 'IS', 'JK', 'JO', 'KL', 'KQ', 'KS', 'L', 'LS', 'MC', 'MI', 'MX',
    'NS', 'NZ', 'OL', 'PA', 'PR', 'SA', 'SI', 'SR', 'SS', 'ST', 'SW', 'SZ', 'T',
    'TA', 'TO', 'TW', 'TWO', 'V', 'VI', 'WA',
]);

// Thrown instead of calling Finnhub while an endpoint is in its failure cool-down; not worth logging again.
class RecentFailure extends Error {}
const logFailure = (what: string, symbol: string, e: unknown) => {
    if (!(e instanceof RecentFailure)) console.error(`Error fetching ${what} for`, symbol, e);
};

let activeRequests = 0;
const waitingForSlot: (() => void)[] = [];
const inFlight = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { value: unknown; freshUntil: number; failed?: boolean }>();

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (activeRequests >= MAX_IN_FLIGHT_PER_KEY * Math.max(1, FINNHUB_KEYS.length)) await new Promise<void>((resolve) => waitingForSlot.push(resolve));
    activeRequests++;
    try {
        return await run();
    } finally {
        activeRequests--;
        waitingForSlot.shift()?.();
    }
}

// The token travels in a header, so cache keys are the same whichever key served them.
// On 429 the next key in the pool gets a turn.
async function fetchWithKeyPool(url: string, ttl: number) {
    if (FINNHUB_KEYS.length === 0) throw new Error('No Finnhub API key configured (FINNHUB_API_KEYS)');
    let res: Response | null = null;
    for (let attempt = 0; attempt < FINNHUB_KEYS.length; attempt++) {
        const key = FINNHUB_KEYS[nextKeyIndex++ % FINNHUB_KEYS.length];
        res = await fetch(url, {
            headers: { 'X-Finnhub-Token': key },
            // Without a timeout a stalled Finnhub socket holds the page for Node's 300s default
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            ...(ttl >= SHARED_CACHE_MIN_TTL ? { next: { revalidate: ttl } } : { cache: 'no-store' as const }),
        });
        if (res.status !== 429) break;
    }
    return res!;
}

// One network call per URL at a time, however many pages ask for it
function request<T>(url: string, ttl = 0): Promise<T> {
    let pending = inFlight.get(url) as Promise<T> | undefined;
    if (!pending) {
        pending = withSlot(async () => {
            const res = await fetchWithKeyPool(url, ttl);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Fetch failed ${res.status}: ${text}`);
            }
            return (await res.json()) as T;
        }).finally(() => inFlight.delete(url));
        inFlight.set(url, pending);
    }
    return pending;
}

// Stale-while-revalidate: after the first fetch nobody waits on Finnhub; expired entries
// are served instantly and refreshed in the background.
async function fetchJSON<T>(url: string, revalidateSeconds = 0): Promise<T> {
    if (!revalidateSeconds) return request<T>(url);

    const store = (entry: { value: unknown; freshUntil: number; failed?: boolean }) => {
        if (responseCache.size >= MAX_CACHE_ENTRIES) responseCache.delete(responseCache.keys().next().value!);
        responseCache.set(url, entry);
    };
    const refresh = () => request<T>(url, revalidateSeconds).then(
        (value) => {
            store({ value, freshUntil: Date.now() + revalidateSeconds * 1000 });
            return value;
        },
        (error) => {
            // A stalling endpoint fails fast for a minute instead of costing every visitor the full timeout.
            // A stale value keeps being served, but its next refresh also waits out the cool-down.
            const existing = responseCache.get(url);
            store(existing && !existing.failed
                ? { value: existing.value, freshUntil: Date.now() + FAILURE_TTL_MS }
                : { value: null, freshUntil: Date.now() + FAILURE_TTL_MS, failed: true });
            throw error;
        },
    );

    const hit = responseCache.get(url);
    if (!hit || (hit.failed && hit.freshUntil < Date.now())) return refresh();
    if (hit.failed) throw new RecentFailure(`Finnhub request failed recently: ${url.split('?')[0]}`);
    if (hit.freshUntil < Date.now()) refresh().catch(() => { /* keep serving the stale value */ });
    return hit.value as T;
}

function getExchangeLabel(symbol: string, exchange?: string) {
    if (exchange?.trim()) {
        return exchange.trim();
    }

    const parts = symbol.split('.');
    const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';

    if (!suffix) {
        return 'US';
    }

    return FINNHUB_EXCHANGE_SUFFIXES.has(suffix) ? suffix : 'US';
}

export async function getQuote(symbol: string, revalidateSeconds = 0) {
    try {
        const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}`;
        // Real-time by default; shared views pass a short cache to stay inside Finnhub's 60 req/min
        return await fetchJSON<FinnhubQuote>(url, revalidateSeconds);
    } catch (e) {
        logFailure('quote', symbol, e);
        return null;
    }
}

// Shared, short-lived quotes for anything shown live on screen (pages and /api/quotes)
// Supports A-Shares, Hong Kong, Taiwan, and US in real-time
export async function getLiveQuotes(symbols: string[]) {
    if (!symbols.length) return {};
    const realtimeMap = await fetchRealtimeQuotes(symbols);

    // Fallback to Finnhub for any US symbol without a realtime result
    const missingUs = symbols.filter((s) => !realtimeMap[s]?.c && hasFinnhubQuotes(s));
    if (missingUs.length > 0) {
        const finnhubQuotes = await Promise.all(missingUs.map((s) => getQuote(s, LIVE_QUOTE_TTL)));
        missingUs.forEach((s, idx) => {
            const fq = finnhubQuotes[idx];
            if (fq?.c) {
                realtimeMap[s] = {
                    symbol: s,
                    name: s,
                    price: fq.c,
                    prevClose: fq.pc || 0,
                    open: fq.o || 0,
                    high: fq.h || 0,
                    low: fq.l || 0,
                    change: fq.d || 0,
                    changePercent: fq.dp || 0,
                    volume: 0,
                    currency: 'USD',
                    exchange: 'US',
                    market: 'us',
                    updatedAt: '',
                    c: fq.c,
                    d: fq.d || 0,
                    dp: fq.dp || 0,
                    h: fq.h || 0,
                    l: fq.l || 0,
                    o: fq.o || 0,
                    pc: fq.pc || 0,
                    t: fq.t || Math.floor(Date.now() / 1000),
                };
            }
        });
    }

    return Object.fromEntries(symbols.map((s) => [s, realtimeMap[s] ?? null]));
}

export async function getCompanyProfile(symbol: string) {
    // Profiles exist for stocks Finnhub free covers; crypto pairs and non-US listings have none
    if (symbol.includes(':') || !hasFinnhubQuotes(symbol)) return null;
    try {
        const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
        // Cache profile for 24 hours
        return await fetchJSON<FinnhubCompanyProfile>(url, 86400);
    } catch (e) {
        logFailure('profile', symbol, e);
        return null;
    }
}

export async function getStockMetrics(symbol: string): Promise<number | null> {
    if (FINNHUB_KEYS.length === 0) {
        console.error('FINNHUB API key is not configured');
        return null;
    }

    try {
        const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`;
        const data = await fetchJSON<FinnhubStockMetrics>(url, 3600);
        const dividendYield = data?.metric?.dividendYieldIndicatedAnnual;
        return typeof dividendYield === 'number' && Number.isFinite(dividendYield)
            ? dividendYield
            : null;
    } catch (error) {
        logFailure('stock metrics', symbol, error);
        return null;
    }
}

export async function getWatchlistData(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    // 1. Fetch real-time quotes across CN, HK, TW, and US
    const realtimeMap = await fetchRealtimeQuotes(symbols);

    // 2. Finnhub free doesn't price Tadawul; Yahoo does (delayed)
    const saudiSymbols = symbols.filter(isTadawulSymbol);
    const saudi = saudiSymbols.length > 0 ? await getYahooDailyQuotes(saudiSymbols) : {};

    // 3. For any remaining US symbols, get Finnhub profile & quote
    const promises = symbols.map(async (sym) => {
        const rt = realtimeMap[sym];
        if (rt && rt.price > 0) {
            return {
                symbol: sym,
                price: rt.price,
                change: rt.change,
                changePercent: rt.changePercent,
                currency: rt.currency,
                name: rt.name || sym,
                logo: undefined,
                marketCap: rt.marketCap,
                peRatio: rt.pe || 0,
            };
        }

        const y = saudi[sym];
        if (y) {
            return {
                symbol: sym,
                price: y.price,
                change: y.change,
                changePercent: y.changePercent,
                currency: y.currency,
                name: y.name || sym,
                logo: undefined,
                marketCap: undefined,
                peRatio: 0,
            };
        }

        const covered = hasFinnhubQuotes(sym);
        const [quote, profile] = covered
            ? await Promise.all([getQuote(sym, LIVE_QUOTE_TTL), getCompanyProfile(sym)])
            : [null, null];

        return {
            symbol: sym,
            price: quote?.c || 0,
            change: quote?.d || 0,
            changePercent: quote?.dp || 0,
            currency: profile?.currency || 'USD',
            name: profile?.name || sym,
            logo: profile?.logo,
            marketCap: profile?.marketCapitalization,
            peRatio: 0,
        };
    });

    return await Promise.all(promises);
}

export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
    try {
        // Multi-market news covering 美股、A股、港股、台股
        const multiNews = await getMultiMarketNews(symbols);
        if (multiNews && multiNews.length > 0) {
            return multiNews;
        }

        // Fallback to Finnhub general news if network error
        const generalUrl = `${FINNHUB_BASE_URL}/news?category=general`;
        const general = await fetchJSON<RawNewsArticle[]>(generalUrl, 300);

        const seen = new Set<string>();
        const unique: RawNewsArticle[] = [];
        for (const art of general || []) {
            if (!validateArticle(art)) continue;
            const key = `${art.id}-${art.url}-${art.headline}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(art);
            if (unique.length >= 20) break;
        }

        return unique.slice(0, 15).map((a, idx) => formatArticle(a, false, undefined, idx));
    } catch (err) {
        console.error('getNews error:', err);
        return [];
    }
}

export const searchStocks = cache(async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
        if (FINNHUB_KEYS.length === 0) {
            // If no token, log and return empty to avoid throwing per requirements
            console.error('Error in stock search:', new Error('FINNHUB API key is not configured'));
            return [];
        }

        const trimmed = typeof query === 'string' ? query.trim() : '';

        // Chinese stock matching (Pinyin, 6-digit pure code, Chinese name keywords)
        const localMatches = trimmed ? findChineseStocks(trimmed) : [];
        const localCandidates: StockWithWatchlistStatus[] = localMatches.map((c) => ({
            symbol: c.symbol,
            name: c.name,
            exchange: c.exchange,
            type: c.type,
            isInWatchlist: false,
        }));

        let results: SearchStockCandidate[] = [];

        if (!trimmed) {
            // Shown in the palette on every page, so no API calls: Finnhub's free tier is 60 req/min
            results = POPULAR_STOCKS.map(({ symbol, name, exchange }) => ({
                symbol,
                description: name,
                displaySymbol: symbol,
                type: 'Common Stock',
                __exchange: exchange,
            }));
        } else {
            // A public server action: only signed-in users may spend Finnhub quota on searches
            if (!(await getSession())?.user) return localCandidates.slice(0, 15);
            const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(trimmed)}`;
            const data = await fetchJSON<FinnhubSearchResponse>(url, 1800);
            results = Array.isArray(data?.result) ? data.result : [];
        }

        const seenSymbols = new Set(localCandidates.map((c) => c.symbol.toUpperCase()));
        const mapped: StockWithWatchlistStatus[] = results
            .map((r) => {
                const upper = (r.symbol || '').toUpperCase();
                const name = r.description || upper;
                const exchangeFromProfile = r.__exchange;
                const exchange = getExchangeLabel(upper, exchangeFromProfile);
                const type = r.type || 'Stock';
                const item: StockWithWatchlistStatus = {
                    symbol: upper,
                    name,
                    exchange,
                    type,
                    isInWatchlist: false,
                };
                return item;
            })
            .filter((item) => !seenSymbols.has(item.symbol));

        return [...localCandidates, ...mapped].slice(0, 15);
    } catch (err) {
        console.error('Error in stock search:', err);
        return [];
    }
});
