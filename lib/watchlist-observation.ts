import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getSymbolAliases } from '@/lib/utils';
import type { UnifiedQuote } from '@/lib/realtime-market';
import { isMarketDate, type WatchlistJournalEntry } from '@/lib/watchlist-review';

export type ReviewStatus = 'watching' | 'validated' | 'invalidated';
export type InitialSnapshot = {
    price: number;
    currency: string;
    source: string;
    asOf: string;
    fetchedAt: string;
    priceBasis: 'last-trade';
    adjustment: 'unadjusted';
};

/** Server-action payload: all dates are ISO strings and no database/user identifiers escape. */
export type WatchlistEntry = {
    symbol: string;
    company: string;
    addedAt: string;
    group?: string;
    note?: string;
    invalidation?: string;
    targetPrice?: number;
    reviewStatus: ReviewStatus;
    reviewedAt?: string;
    observationUpdatedAt?: string;
    initialSnapshot?: InitialSnapshot;
    nextReviewDate?: string;
    proximityPercent?: number;
};

/** Current quote fields are independent of the immutable observation snapshot. */
export type WatchlistQuoteFields = {
    price: number;
    change?: number;
    changePercent?: number;
    currency: string;
    name: string;
    logo?: string;
    marketCap?: number;
    peRatio: number;
    priceBasis?: 'last-trade' | 'previous-close';
    source?: string;
    asOf?: string;
    fetchedAt?: string;
    previousClose?: number;
};

export type ObservationInput = {
    group?: string | null;
    note?: string | null;
    invalidation?: string | null;
    targetPrice?: number | null;
    reviewStatus?: ReviewStatus;
    nextReviewDate?: string | null;
    proximityPercent?: number | null;
};

export const OBSERVATION_LIMITS = { group: 80, note: 2000, invalidation: 2000 } as const;
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['watching', 'validated', 'invalidated'];

export function validateObservationInput(input: unknown): ObservationInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的观察记录');
    const values = input as Record<string, unknown>;
    if (Object.keys(values).some((key) => !['group', 'note', 'invalidation', 'targetPrice', 'reviewStatus', 'nextReviewDate', 'proximityPercent'].includes(key))) {
        throw new Error('无效的观察字段');
    }
    const result: ObservationInput = {};
    for (const key of ['group', 'note', 'invalidation'] as const) {
        const value = values[key];
        if (value === undefined) continue;
        if (value !== null && (typeof value !== 'string' || value.length > OBSERVATION_LIMITS[key])) {
            throw new Error(`无效的观察字段：${key}（最多 ${OBSERVATION_LIMITS[key]} 字）`);
        }
        result[key] = typeof value === 'string' ? value.trim() || null : null;
    }
    if (values.targetPrice !== undefined) {
        if (values.targetPrice !== null && (typeof values.targetPrice !== 'number' || !Number.isFinite(values.targetPrice) || values.targetPrice <= 0)) {
            throw new Error('观察价格必须为正数');
        }
        result.targetPrice = values.targetPrice as number | null;
    }
    if (values.reviewStatus !== undefined) {
        if (!REVIEW_STATUSES.includes(values.reviewStatus as ReviewStatus)) throw new Error('无效的复核状态');
        result.reviewStatus = values.reviewStatus as ReviewStatus;
    }
    if (values.nextReviewDate !== undefined) {
        if (values.nextReviewDate !== null && !isMarketDate(values.nextReviewDate)) throw new Error('无效的下次复核日期');
        result.nextReviewDate = values.nextReviewDate as string | null;
    }
    if (values.proximityPercent !== undefined) {
        if (values.proximityPercent !== null && (typeof values.proximityPercent !== 'number' || !Number.isFinite(values.proximityPercent) || values.proximityPercent < 0 || values.proximityPercent > 100)) throw new Error('接近关键价比例须为 0–100');
        result.proximityPercent = values.proximityPercent as number | null;
    }
    if (!Object.keys(result).length) throw new Error('观察记录不能为空');
    return result;
}

export function snapshotFromQuote(quote: UnifiedQuote | null | undefined): InitialSnapshot | undefined {
    if (!quote || quote.priceBasis !== 'last-trade' || !Number.isFinite(quote.price) || quote.price <= 0
        || !quote.currency?.trim() || !quote.source?.trim() || !quote.asOf || !quote.fetchedAt
        || !Number.isFinite(Date.parse(quote.asOf)) || Date.parse(quote.asOf) <= 0
        || !Number.isFinite(Date.parse(quote.fetchedAt)) || Date.parse(quote.fetchedAt) <= 0) return undefined;
    return {
        price: quote.price, currency: quote.currency, source: quote.source,
        asOf: quote.asOf, fetchedAt: quote.fetchedAt,
        priceBasis: 'last-trade', adjustment: 'unadjusted',
    };
}

/** Internal, JSON-serialized persistence shape. Nulls retain intentional clears across legacy aliases. */
export type SavedWatchlistRecord = Omit<WatchlistEntry, 'reviewStatus' | 'group' | 'note' | 'invalidation' | 'targetPrice' | 'reviewedAt' | 'nextReviewDate' | 'proximityPercent'> & {
    _id: string;
    group?: string | null;
    note?: string | null;
    invalidation?: string | null;
    targetPrice?: number | null;
    reviewStatus?: ReviewStatus;
    reviewedAt?: string | null;
    nextReviewDate?: string | null;
    proximityPercent?: number | null;
    journal?: WatchlistJournalEntry[];
    journalVersion?: number;
};

export function observationOwner(records: SavedWatchlistRecord[]): SavedWatchlistRecord {
    return [...records].sort((a, b) =>
        (Date.parse(b.observationUpdatedAt || '') || 0) - (Date.parse(a.observationUpdatedAt || '') || 0)
        || Date.parse(a.addedAt) - Date.parse(b.addedAt)
        || a._id.localeCompare(b._id))[0];
}

export function mergeWatchlistRecords(records: SavedWatchlistRecord[]): WatchlistEntry[] {
    const groups = new Map<string, SavedWatchlistRecord[]>();
    for (const record of records) {
        const canonical = identifyMarketAndCode(record.symbol).normalizedSymbol;
        groups.set(canonical, [...(groups.get(canonical) || []), record]);
    }
    return [...groups.entries()].map(([symbol, aliases]) => {
        const earliest = [...aliases].sort((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt));
        const owner = observationOwner(aliases);
        const company = aliases.map((item) => item.company).find((name) =>
            name?.trim() && !getSymbolAliases(symbol).includes(name.trim().toUpperCase()));
        // A saved revision is an authoritative edit (including clears). Before the first edit,
        // combine legacy text so deduplication cannot discard notes on a different alias.
        const fields = {
            ...owner,
            group: earliest.find((item) => item.group)?.group,
            note: [...new Set(earliest.map((item) => item.note).filter(Boolean))].join('\n\n') || undefined,
            invalidation: [...new Set(earliest.map((item) => item.invalidation).filter(Boolean))].join('\n\n') || undefined,
            targetPrice: earliest.find((item) => item.targetPrice != null)?.targetPrice,
            reviewStatus: earliest.find((item) => item.reviewStatus)?.reviewStatus,
            reviewedAt: earliest.find((item) => item.reviewedAt)?.reviewedAt,
            nextReviewDate: earliest.find((item) => item.nextReviewDate)?.nextReviewDate,
            proximityPercent: earliest.find((item) => item.proximityPercent != null)?.proximityPercent,
            // Older partial revisions can still inherit fields present only on an alias.
            ...(owner.observationUpdatedAt ? owner : {}),
        };
        return {
            symbol, company: company || earliest[0].company, addedAt: earliest[0].addedAt,
            group: fields.group ?? undefined, note: fields.note ?? undefined,
            invalidation: fields.invalidation ?? undefined, targetPrice: fields.targetPrice ?? undefined,
            reviewStatus: fields.reviewStatus || 'watching', reviewedAt: fields.reviewedAt ?? undefined,
            observationUpdatedAt: owner.observationUpdatedAt,
            initialSnapshot: earliest.find((item) => item.initialSnapshot)?.initialSnapshot,
            nextReviewDate: fields.nextReviewDate ?? undefined,
            proximityPercent: fields.proximityPercent ?? undefined,
        };
    }).sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
}
