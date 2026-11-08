import type { InitialSnapshot, ReviewStatus, WatchlistEntry } from '@/lib/watchlist-observation';
import { validCalendarDate } from '@/lib/market/dates';

export type ObservationState = {
    group?: string;
    note?: string;
    invalidation?: string;
    targetPrice?: number;
    reviewStatus: ReviewStatus;
    reviewedAt?: string;
    nextReviewDate?: string;
    proximityPercent?: number;
};

export type ObservationRevision = {
    kind: 'observation';
    id: string;
    recordedAt: string;
    /** null means that the original modification time is unknown, never addedAt. */
    modifiedAt: string | null;
    source: 'legacy-capture' | 'saved-revision' | 'edit';
    /** Original saved alias, when this is a raw record state rather than a merged view. */
    sourceSymbol?: string;
    /** Review which atomically appended this revision, used to reconstruct idempotent responses. */
    reviewId?: string;
    observation: ObservationState;
};

export type WatchlistReviewInput = {
    tradingDate: string;
    hypothesis: string;
    changes: string;
    conclusion: string;
    verificationType: 'price' | 'fact' | 'judgment';
    evidenceURLs?: string[];
    nextReviewDate?: string | null;
    correctionOf?: string;
    clientRequestId: string;
};

export type WatchlistReview = Omit<WatchlistReviewInput, 'evidenceURLs'> & {
    kind: 'review';
    id: string;
    createdAt: string;
    evidenceURLs: string[];
    sourceQuote?: InitialSnapshot;
};

export type WatchlistJournalEntry = ObservationRevision | WatchlistReview;
export type WatchlistJournalPage = { success: true; entries: WatchlistJournalEntry[]; nextCursor?: string }
    | { success: false; code: 'NOT_FOUND'; error: string };

export const REVIEW_LIMITS = { text: 2000, evidenceURLs: 10, url: 2000, clientRequestId: 100 } as const;

/** Calendar dates are market-local labels. Never convert them to a browser/UTC day. */
export function isMarketDate(value: unknown): value is string {
    return validCalendarDate(value) && value >= '1900-01-01' && value <= '9999-12-31';
}

export function getProximityPercent(value?: number | null): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : 2;
}

export function observationState(entry: ObservationState | WatchlistEntry): ObservationState {
    return {
        // MongoDB can retain undefined Mixed fields as null; both mean an absent optional value.
        group: entry.group ?? undefined, note: entry.note ?? undefined, invalidation: entry.invalidation ?? undefined,
        targetPrice: entry.targetPrice ?? undefined, reviewStatus: entry.reviewStatus,
        reviewedAt: entry.reviewedAt ?? undefined, nextReviewDate: entry.nextReviewDate ?? undefined,
        proximityPercent: entry.proximityPercent ?? undefined,
    };
}

export function validateReviewInput(input: unknown): WatchlistReviewInput & { evidenceURLs: string[] } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的复核条目');
    const values = input as Record<string, unknown>;
    if (Object.keys(values).some((key) => !['tradingDate', 'hypothesis', 'changes', 'conclusion', 'verificationType', 'evidenceURLs', 'nextReviewDate', 'correctionOf', 'clientRequestId'].includes(key))) {
        throw new Error('无效的复核字段');
    }
    if (!isMarketDate(values.tradingDate)) throw new Error('请选择有效的交易日期（YYYY-MM-DD）');
    for (const key of ['hypothesis', 'changes', 'conclusion'] as const) {
        if (typeof values[key] !== 'string' || !values[key].trim() || values[key].length > REVIEW_LIMITS.text) throw new Error(`无效的复核字段：${key}（1–${REVIEW_LIMITS.text} 字）`);
    }
    if (!['price', 'fact', 'judgment'].includes(values.verificationType as string)) throw new Error('无效的验证类型');
    if (typeof values.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(values.clientRequestId)) throw new Error('无效的复核请求标识');
    if (values.correctionOf !== undefined && (typeof values.correctionOf !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(values.correctionOf))) throw new Error('无效的更正引用');
    if (values.nextReviewDate !== undefined && values.nextReviewDate !== null && !isMarketDate(values.nextReviewDate)) throw new Error('无效的下次复核日期');
    const urls = values.evidenceURLs ?? [];
    if (!Array.isArray(urls) || urls.length > REVIEW_LIMITS.evidenceURLs) throw new Error('证据链接最多 10 个');
    const evidenceURLs = urls.map((value) => {
        if (typeof value !== 'string' || value.length > REVIEW_LIMITS.url) throw new Error('无效的证据链接');
        let url: URL;
        try { url = new URL(value.trim()); } catch { throw new Error('无效的证据链接'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('证据链接须为 HTTP/HTTPS 地址');
        return url.href;
    });
    return {
        tradingDate: values.tradingDate, hypothesis: (values.hypothesis as string).trim(),
        changes: (values.changes as string).trim(), conclusion: (values.conclusion as string).trim(),
        verificationType: values.verificationType as WatchlistReviewInput['verificationType'],
        evidenceURLs, clientRequestId: values.clientRequestId,
        ...(values.correctionOf ? { correctionOf: values.correctionOf as string } : {}),
        ...(values.nextReviewDate !== undefined ? { nextReviewDate: values.nextReviewDate as string | null } : {}),
    };
}

export function journalTime(entry: WatchlistJournalEntry): string {
    return entry.kind === 'observation' ? entry.recordedAt : entry.createdAt;
}

export function compareJournalEntries(a: WatchlistJournalEntry, b: WatchlistJournalEntry): number {
    return journalTime(b).localeCompare(journalTime(a)) || b.id.localeCompare(a.id);
}

/** Include only client-owned fields when comparing retries; quote/time are server-owned. */
export function reviewRequest(entry: WatchlistReview): WatchlistReviewInput {
    return {
        tradingDate: entry.tradingDate, hypothesis: entry.hypothesis, changes: entry.changes,
        conclusion: entry.conclusion, verificationType: entry.verificationType,
        evidenceURLs: entry.evidenceURLs, clientRequestId: entry.clientRequestId,
        ...(entry.correctionOf ? { correctionOf: entry.correctionOf } : {}),
        ...(entry.nextReviewDate !== undefined ? { nextReviewDate: entry.nextReviewDate } : {}),
    };
}
