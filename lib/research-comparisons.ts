import type { DailyResearchResult } from '@/lib/market/daily-research';
import type { ChartSeries } from '@/lib/realtime-market';
import type { ObservationRevision } from '@/lib/watchlist-review';

export const DAILY_RESEARCH_ALGORITHM_VERSION = 'completed-day-common-set-v1';
export type ComparisonObservationReference = { symbolId: string; observationId: string; version: string };
export type ResearchComparisonPayload = {
    caption: string;
    algorithmVersion: string;
    result: DailyResearchResult;
    originalSeries: { symbol: string; series: ChartSeries | null }[];
    observationReference?: ComparisonObservationReference;
    originalObservation?: ObservationRevision;
};
export type SavedResearchComparison = ResearchComparisonPayload & { id: string; savedAt: string };
export type ComparisonDraft = { id: string; expiresAt: string };
export type DailyResearchDraftResult = DailyResearchResult & { draft: ComparisonDraft };
export type ComparisonActionResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export type SaveResearchComparisonInput = {
    draftId: string; requestId: string; caption: string;
    observationReference?: ComparisonObservationReference; confirmOriginalObservation?: boolean;
};
export type ComparisonSummary = Pick<SavedResearchComparison, 'id' | 'savedAt' | 'caption' | 'algorithmVersion'> & {
    benchmarkSymbol: string; symbols: string[]; fetchedAt: string; groupName?: string;
};
export class ComparisonError extends Error {
    constructor(public code: string, message: string) { super(message); }
}

// The backup boundary shares this strict, recursive allowlist. In particular, Mixed fields
// must not import userId, action payloads or arbitrary nested objects from uploaded JSON.
type Check = (value: unknown) => void;
const invalid = (): never => { throw new ComparisonError('INVALID_INPUT', '对照资料字段或格式无效'); };
const text = (max = 2000): Check => value => { if (typeof value !== 'string' || value.length > max) invalid(); };
const number: Check = value => { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(); };
const timestamp: Check = value => { text(40)(value); if (!Number.isFinite(Date.parse(value as string))) invalid(); };
const date: Check = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) invalid(); };
const optional = (check: Check): Check => value => { if (value !== undefined) check(value); };
const nullable = (check: Check): Check => value => { if (value !== null) check(value); };
const choice = (...values: unknown[]): Check => value => { if (!values.includes(value)) invalid(); };
const array = (check: Check, max: number): Check => value => { if (!Array.isArray(value) || value.length > max) invalid(); (value as unknown[]).forEach(check); };
const object = (fields: Record<string, Check>): Check => value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !Object.hasOwn(fields, key))) invalid();
    for (const [key, check] of Object.entries(fields)) check(row[key]);
};
const strings = array(text(100), 500);
const numbers = array(number, 500);
const member = object({ symbolId: text(40), symbol: text(25) });
const observationReference = object({ symbolId: text(40), observationId: text(100), version: timestamp });
const observation = object({
    kind: choice('observation'), id: text(100), recordedAt: timestamp, modifiedAt: nullable(timestamp),
    source: choice('legacy-capture', 'saved-revision', 'edit'), sourceSymbol: optional(text(40)), reviewId: optional(text(100)),
    // Historical alias captures may contain merged text longer than today's input limits.
    observation: object({ group: optional(text(80)), note: optional(text(14 * 1024 * 1024)), invalidation: optional(text(14 * 1024 * 1024)), targetPrice: optional(number),
        reviewStatus: choice('watching', 'validated', 'invalidated'), reviewedAt: optional(timestamp), nextReviewDate: optional(date), proximityPercent: optional(number) }),
});
/** BSON Mixed journals encode explicit undefined optional state fields as null. */
export function normalizeComparisonObservation(value: unknown): ObservationRevision {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const row = structuredClone(value) as Record<string, unknown>;
    const state = row.observation;
    if (state && typeof state === 'object' && !Array.isArray(state)) {
        const fields = state as Record<string, unknown>;
        for (const key of ['group', 'note', 'invalidation', 'targetPrice', 'reviewedAt', 'nextReviewDate', 'proximityPercent']) {
            if (fields[key] === null) delete fields[key];
        }
    }
    // Preserve the strict whitelist and required state/identity checks after normalization.
    observation(row);
    return row as ObservationRevision;
}
const interval: Check = value => {
    const row = value as { status?: string };
    if (row?.status === 'unavailable') object({ status: choice('unavailable'), reason: text(), commonPoints: number, requiredPoints: number })(value);
    else object({ status: choice('available'), intervals: choice(5, 20), commonPoints: number, startDate: date, endDate: date,
        stockReturn: number, benchmarkReturn: number, excessPercentagePoints: number, stockCloses: numbers, benchmarkCloses: numbers, dates: array(date, 21) })(value);
};
const comparison: Check = value => {
    const row = value as { status?: string };
    if (row?.status === 'unavailable') object({ status: choice('unavailable'), reason: text() })(value);
    else object({ status: choice('available'), source: text(100), adjustment: choice('forward', 'unadjusted'), actualKey: text(100), currency: text(20),
        fetchedAt: object({ stock: timestamp, benchmark: timestamp }), five: interval, twenty: interval,
        missingStockDates: strings, missingBenchmarkDates: strings, excludedCurrentDates: strings })(value);
};
const result = object({
    scope: choice('watched', 'group'), benchmarkSymbol: text(25), fetchedAt: timestamp,
    group: optional(object({ id: text(100), name: text(60), purpose: optional(choice('peer', 'theme')), members: array(member, 20), membershipSavedAt: timestamp })),
    rows: array(object({ symbolId: text(40), symbol: text(25), comparison, volume: object({
        status: choice('available', 'unavailable'), reason: optional(text()), date: optional(date), volume: optional(number), median: optional(number), ratio: optional(number),
        sampleDates: array(date, 20), sampleVolumes: array(nullable(number), 20), missingDates: strings, sampleSize: number, requiredSample: choice(20), volumeUnit: choice('shares'),
        source: optional(text(100)), actualKey: optional(text(100)), fetchedAt: optional(timestamp),
    }) }), 20), omittedMembers: array(member, 100), commonDates: array(date, 21),
});
const series = nullable(object({
    symbol: text(25), market: choice('cn', 'hk', 'tw', 'us', 'unknown'), period: choice('1d', '5d', '1m', '3m', '1y', '5y'), interval: choice('minute', 'day', 'week', 'month'),
    adjustment: choice('forward', 'unadjusted', 'unknown'), source: text(100), asOf: optional(text(100)), fetchedAt: timestamp,
    provenance: object({ requestedAdjustment: choice('forward', 'unadjusted', 'unknown'), requestedKey: optional(text(100)), actualKey: text(100), sourceInterval: choice('minute', 'day', 'week', 'month') }),
    volumeUnit: choice('shares'), currency: text(20), points: array(object({ time: text(100), date: text(20), close: number,
        open: optional(number), high: optional(number), low: optional(number), volume: optional(number), avgPrice: optional(number) }), 500),
    periodHigh: number, periodLow: number, latestPrice: number, prevClose: optional(number), open: optional(number), high: optional(number), low: optional(number),
    volume: optional(number), turnover: optional(number), turnoverRate: optional(number), amplitude: optional(number), pe: optional(number), change: number, changePercent: number,
}));
export function validateResearchComparisonPayload(value: unknown): ResearchComparisonPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const normalized = structuredClone(value) as Record<string, unknown>;
    if (normalized.originalObservation !== undefined) normalized.originalObservation = normalizeComparisonObservation(normalized.originalObservation);
    object({ caption: text(2000), algorithmVersion: choice(DAILY_RESEARCH_ALGORITHM_VERSION), result,
        originalSeries: array(object({ symbol: text(25), series }), 21), observationReference: optional(observationReference), originalObservation: optional(observation) })(normalized);
    const payload = normalized as ResearchComparisonPayload;
    if (!payload.caption.trim() || Boolean(payload.observationReference) !== Boolean(payload.originalObservation)) invalid();
    if (payload.observationReference && (payload.observationReference.observationId !== payload.originalObservation!.id
        || payload.observationReference.version !== payload.originalObservation!.recordedAt
        || !payload.result.rows.some(row => row.symbolId === payload.observationReference!.symbolId))) invalid();
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 2_000_000) throw new ComparisonError('EVIDENCE_TOO_LARGE', '本次对照与原判断合计超过保存容量，原文未截断。可取消原判断引用后独立保存对照依据。');
    // Optional undefined values must remain absent through BSON/JSON round trips.
    return JSON.parse(JSON.stringify(payload)) as ResearchComparisonPayload;
}
export function validateSaveComparisonInput(input: unknown): SaveResearchComparisonInput {
    object({ draftId: text(100), requestId: text(100), caption: text(2000), observationReference: optional(observationReference), confirmOriginalObservation: optional(choice(true, false)) })(input);
    const value = input as SaveResearchComparisonInput;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(value.requestId) || !/^[A-Za-z0-9_-]{1,100}$/.test(value.draftId) || !value.caption.trim()) invalid();
    return { ...value, caption: value.caption.trim() };
}

/** Ephemeral drafts are never evidence, exported data, or durable records. */
export function createComparisonDraftStore(ttlMs = 30 * 60_000, maxEntries = 128, perOwner = 8, maxBytes = 16_000_000) {
    const drafts = new Map<string, { userId: string; expires: number; bytes: number; result: DailyResearchResult; originalSeries: ResearchComparisonPayload['originalSeries'] }>();
    function prune() { for (const [id, draft] of drafts) if (draft.expires <= Date.now()) drafts.delete(id); }
    return {
        issue(userId: string, displayed: DailyResearchResult, originalSeries: ResearchComparisonPayload['originalSeries']): ComparisonDraft {
            prune();
            const result = structuredClone(displayed);
            const originals = structuredClone(originalSeries);
            const bytes = new TextEncoder().encode(JSON.stringify({ result, originalSeries: originals })).byteLength;
            if (bytes > Math.min(2_000_000, maxBytes)) throw new ComparisonError('DRAFT_TOO_LARGE', '本次来源样本过大，无法留存');
            const own = [...drafts].filter(([, draft]) => draft.userId === userId);
            while (own.length >= perOwner) drafts.delete(own.shift()![0]);
            while (drafts.size >= maxEntries || [...drafts.values()].reduce((sum, draft) => sum + draft.bytes, bytes) > maxBytes) drafts.delete(drafts.keys().next().value!);
            const id = crypto.randomUUID();
            const expires = Date.now() + ttlMs;
            drafts.set(id, { userId, expires, bytes, result, originalSeries: originals });
            return { id, expiresAt: new Date(expires).toISOString() };
        },
        read(userId: string, id: string) {
            prune(); const draft = drafts.get(id);
            if (!draft || draft.userId !== userId) throw new ComparisonError('DRAFT_EXPIRED', '本次对照草稿已过期、服务已重启或不属于当前账户。请重新读取并核对后保存；旧结果不会被自动替换。');
            return structuredClone({ result: draft.result, originalSeries: draft.originalSeries });
        },
    };
}
export const comparisonDrafts = createComparisonDraftStore();
