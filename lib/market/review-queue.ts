import { identifyMarketAndCode } from './instrument';
import { getInstrumentSession } from './sessions';
import { validCalendarDate } from './dates';
import type { WatchlistEntry } from '@/lib/watchlist-observation';

export const MAX_REVIEW_QUOTE_AGE_MS = 120_000;
export type ReviewQueueQuote = { c?: number; currency?: string; source?: string; asOf?: string; priceBasis?: 'last-trade' | 'previous-close'; stale?: boolean };
export type ReviewQueueItem = {
    symbol: string;
    exchangeDate: string;
    timeZone: string;
    dueDate?: string;
    proximity?: { signedPercent: number; absolutePercent: number; threshold: number; price: number; targetPrice: number; source: string; asOf: string };
};

export const isReviewDate = validCalendarDate;

/** Distance is signed relative to the observation line; proximity uses its absolute value in both directions. */
export function observationDistance(targetPrice?: number, price?: number): { signedPercent: number; absolutePercent: number } | undefined {
    if (targetPrice == null || price == null || !Number.isFinite(targetPrice) || !Number.isFinite(price) || targetPrice <= 0 || price <= 0) return;
    const signedPercent = (price / targetPrice - 1) * 100;
    if (!Number.isFinite(signedPercent)) return;
    return { signedPercent, absolutePercent: Math.abs(signedPercent) };
}

/** Pure and clock-injected. This single snapshot never establishes a crossing event. */
export function reviewQueueItem(entry: Pick<WatchlistEntry, 'symbol' | 'targetPrice' | 'nextReviewDate' | 'proximityPercent'>, quote: ReviewQueueQuote | null | undefined, now: Date): ReviewQueueItem {
    const session = getInstrumentSession(entry.symbol, now);
    const item: ReviewQueueItem = { symbol: entry.symbol, exchangeDate: session.exchangeDate, timeZone: session.timeZone };
    if (entry.nextReviewDate && isReviewDate(entry.nextReviewDate) && session.exchangeDate && entry.nextReviewDate <= session.exchangeDate) item.dueDate = entry.nextReviewDate;
    const distance = observationDistance(entry.targetPrice, quote?.c);
    const threshold = entry.proximityPercent ?? 2;
    const timestamp = Date.parse(quote?.asOf ?? '');
    const age = now.getTime() - timestamp;
    if (!distance || !Number.isFinite(threshold) || threshold < 0 || threshold > 100 || distance.absolutePercent > threshold + 1e-10
        || !quote || quote.stale || quote.priceBasis !== 'last-trade' || !quote.source?.trim()
        || quote.currency !== identifyMarketAndCode(entry.symbol).currency || !Number.isFinite(age) || age < 0 || age > MAX_REVIEW_QUOTE_AGE_MS
        || !session.isTrading || session.calendarStatus !== 'verified') return item;
    const sourceSession = getInstrumentSession(entry.symbol, new Date(timestamp));
    if (!sourceSession.isTrading || sourceSession.calendarStatus !== 'verified' || sourceSession.exchangeDate !== session.exchangeDate) return item;
    item.proximity = { ...distance, threshold, price: quote.c!, targetPrice: entry.targetPrice!, source: quote.source, asOf: new Date(timestamp).toISOString() };
    return item;
}

export function buildReviewQueue(entries: Pick<WatchlistEntry, 'symbol' | 'targetPrice' | 'nextReviewDate' | 'proximityPercent'>[], quotes: Record<string, ReviewQueueQuote | null | undefined>, now: Date): ReviewQueueItem[] {
    return entries.map(entry => reviewQueueItem(entry, quotes[entry.symbol], now)).filter(item => item.dueDate || item.proximity)
        .sort((a, b) => (a.dueDate ? 0 : 1) - (b.dueDate ? 0 : 1)
            || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
            || (a.proximity?.absolutePercent ?? Infinity) - (b.proximity?.absolutePercent ?? Infinity)
            || a.symbol.localeCompare(b.symbol));
}
