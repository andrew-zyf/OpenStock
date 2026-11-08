import { fetchRealtimeQuotes } from '@/lib/realtime-market';
import { getInstrumentSession } from '@/lib/market/sessions';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { freshObservation, validObservation, MAX_ALERT_QUOTE_AGE_MS, type AlertObservation, type AlertQuote } from './evaluation';

export function isLegacyCryptoSymbol(symbol: string): boolean {
    return /^BINANCE:[A-Z0-9]{2,20}$/.test(symbol);
}

export function validateAlertQuote(symbol: string, quote: AlertQuote | null | undefined, now: Date, legacyCrypto = false): AlertObservation | null {
    if (legacyCrypto && isLegacyCryptoSymbol(symbol)) return freshObservation(quote, now);
    const session = getInstrumentSession(symbol, now);
    const timestamp = quote?.asOf ? Date.parse(quote.asOf) : NaN;
    const sourceSession = Number.isFinite(timestamp) ? getInstrumentSession(symbol, new Date(timestamp)) : session;
    return validObservation(quote, session, sourceSession, now);
}

// US Tencent quotes can be delayed. Retain Finnhub coverage through a separate no-store
// request, never getQuote's hourly/stale cache. Provider time remains mandatory.
async function freshFinnhubQuote(symbol: string): Promise<AlertQuote | null> {
    const env = process.env;
    const keys = (env.FINNHUB_API_KEYS || env.NEXT_PUBLIC_FINNHUB_API_KEY || env.FINNHUB_API_KEY || '').split(',').map(key => key.trim()).filter(Boolean);
    for (const key of keys) {
        try {
            const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`, {
                headers: { 'X-Finnhub-Token': key }, cache: 'no-store', signal: AbortSignal.timeout(5000),
            });
            if (response.status === 429) continue;
            if (!response.ok) return null;
            const quote = await response.json();
            const timestamp = typeof quote.t === 'number' && quote.t > 0 ? new Date(quote.t * 1000) : null;
            return {
                price: typeof quote.c === 'number' ? quote.c : NaN,
                priceBasis: 'last-trade', source: 'finnhub',
                asOf: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined,
            };
        } catch { return null; }
    }
    return null;
}

/** Deliberately bypass getLiveQuotes/getQuote and their hourly/stale Finnhub fallbacks. */
export async function getAlertObservations(symbols: string[], now?: Date, legacyCryptoSymbols: string[] = []): Promise<Record<string, AlertObservation | null>> {
    const quotes = await fetchRealtimeQuotes(symbols);
    const observations: Record<string, AlertObservation | null> = {};
    for (const symbol of symbols) {
        let checkedAt = now ?? new Date();
        let sample = validateAlertQuote(symbol, quotes[symbol], checkedAt);
        const meta = identifyMarketAndCode(symbol);
        const session = getInstrumentSession(symbol, checkedAt);
        const recentSession = getInstrumentSession(symbol, new Date(checkedAt.getTime() - MAX_ALERT_QUOTE_AGE_MS));
        const mayObserveRecentTrade = session.calendarStatus === 'verified'
            && (session.isTrading || (recentSession.isTrading && recentSession.exchangeDate === session.exchangeDate));
        const legacyCrypto = legacyCryptoSymbols.includes(symbol) && isLegacyCryptoSymbol(symbol);
        if (!sample && (legacyCrypto || (meta.market === 'us' && getInstrumentCapabilities(symbol).alerts && mayObserveRecentTrade))) {
            const fallback = await freshFinnhubQuote(legacyCrypto ? symbol : meta.normalizedSymbol);
            checkedAt = now ?? new Date();
            sample = validateAlertQuote(symbol, fallback, checkedAt, legacyCrypto);
        }
        observations[symbol] = sample;
    }
    return observations;
}
