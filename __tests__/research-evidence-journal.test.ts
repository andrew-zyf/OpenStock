import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedWatchlistRecord } from '@/lib/watchlist-observation';
import type { WatchlistReviewInput, WatchlistJournalEntry } from '@/lib/watchlist-review';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), lifecycle: vi.fn(), find: vi.fn(), update: vi.fn(), quote: vi.fn(), revalidate: vi.fn(), factExists: vi.fn(), comparisonExists: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/realtime-market', () => ({ fetchRealtimeQuotes: mocks.quote }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { find: mocks.find, findOneAndUpdate: mocks.update } }));
vi.mock('@/database/models/research-fact.model', () => ({ ResearchFact: { exists: mocks.factExists } }));
vi.mock('@/database/models/research-comparison.model', () => ({ ResearchComparisonRecord: { exists: mocks.comparisonExists } }));
vi.mock('@/lib/watchlist-lifecycle', () => ({
    withWatchlistLifecycle: mocks.lifecycle,
    WatchlistLifecycleError: class extends Error { failure() { return { success: false, code: 'BUSY' }; } },
}));
import { appendWatchlistReview } from '@/lib/actions/watchlist.actions';

type Row = SavedWatchlistRecord & { userId: string };
type Filter = { _id?: string; userId: string; symbol: string | { $in: string[] }; archivedAt?: null; observationUpdatedAt?: Date | null; journalVersion?: number | null };
type Change = { $push: { journal: { $each: WatchlistJournalEntry[] } }; $inc: { journalVersion: number }; $set?: Record<string, unknown> };
const rows: Row[] = [];
const facts: { userId: string; id: string; symbol: string }[] = [];
const comparisons: { userId: string; id: string; symbols: string[] }[] = [];
const factId = '11111111-1111-4111-8111-111111111111';
const comparisonId = '111111111111111111111111';
const input: WatchlistReviewInput = { tradingDate: '2026-11-08', hypothesis: '盈利改善的原假设', changes: '人工登记新资料', conclusion: '仍需核查利润率', verificationType: 'fact',
    clientRequestId: 'evidence-review-request', evidenceURLs: ['https://example.com/report'], evidenceReferences: [{ kind: 'fact', id: factId }, { kind: 'comparison', id: comparisonId }] };
function row(overrides: Partial<Row> = {}): Row {
    return { _id: '222222222222222222222222', userId: 'owner', symbol: '00700.HK', company: 'Tencent', addedAt: '2026-11-01T00:00:00Z', note: '原假设', reviewStatus: 'watching', journalVersion: 1, journal: [], ...overrides };
}
function matches(item: Row, filter: Filter): boolean {
    return item.userId === filter.userId && (!filter._id || filter._id === item._id)
        && (typeof filter.symbol === 'string' ? filter.symbol === item.symbol : filter.symbol.$in.includes(item.symbol))
        && (!Object.hasOwn(filter, 'archivedAt') || item.archivedAt == null)
        && (!Object.hasOwn(filter, 'observationUpdatedAt') || (item.observationUpdatedAt ?? null) === (filter.observationUpdatedAt?.toISOString() ?? null))
        && (!Object.hasOwn(filter, 'journalVersion') || (item.journalVersion ?? null) === filter.journalVersion);
}
async function update(filter: Filter, change: Change) {
    const saved = rows.find((item) => matches(item, filter));
    if (!saved) return null;
    if (change.$set) Object.assign(saved, JSON.parse(JSON.stringify(change.$set)));
    saved.journal = [...(saved.journal ?? []), ...structuredClone(change.$push.journal.$each)];
    saved.journalVersion = (saved.journalVersion ?? 0) + change.$inc.journalVersion;
    return structuredClone(saved);
}
beforeEach(() => {
    vi.clearAllMocks(); rows.splice(0); facts.splice(0); comparisons.splice(0);
    rows.push(row()); facts.push({ userId: 'owner', id: factId, symbol: '00700.HK' }); comparisons.push({ userId: 'owner', id: comparisonId, symbols: ['00700.HK'] });
    mocks.auth.mockResolvedValue('owner'); mocks.quote.mockResolvedValue({});
    mocks.lifecycle.mockImplementation(async (_owner: string, _intent: unknown, operation: () => Promise<unknown>) => operation());
    mocks.find.mockImplementation((filter: Filter) => {
        const result = { select: () => result, sort: async () => structuredClone(rows.filter((item) => matches(item, filter))) }; return result;
    });
    mocks.update.mockImplementation(update);
    mocks.factExists.mockImplementation(async (filter: { userId: string; id: string; symbol: string }) => facts.some((fact) => fact.userId === filter.userId && fact.id === filter.id && fact.symbol === filter.symbol) ? { _id: factId } : null);
    mocks.comparisonExists.mockImplementation(async (filter: { userId: string; _id: string; 'result.rows.symbol': string }) => comparisons.some((snapshot) => snapshot.userId === filter.userId && snapshot.id === filter._id && snapshot.symbols.includes(filter['result.rows.symbol'])) ? { _id: comparisonId } : null);
});

describe('journal evidence validation and exact append retries', () => {
    it('writes validated owner-and-symbol fact/comparison refs into one review without changing viewpoint validity', async () => {
        const result = await appendWatchlistReview('HKEX:700', input);
        expect(result).toMatchObject({ success: true, deduplicated: false, review: { evidenceReferences: input.evidenceReferences, verificationType: 'fact' }, entry: { reviewStatus: 'watching' } });
        expect(rows[0].journal).toHaveLength(1);
        expect(mocks.factExists).toHaveBeenCalledWith({ userId: 'owner', id: factId, symbol: '00700.HK' });
        expect(mocks.comparisonExists).toHaveBeenCalledWith({ userId: 'owner', _id: comparisonId, 'result.rows.symbol': '00700.HK' });
        expect(mocks.update.mock.calls[0][0]).toMatchObject({ userId: 'owner', _id: rows[0]._id, symbol: '00700.HK', archivedAt: null, journalVersion: 1 });
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('$set.reviewStatus');
    });
    it('deduplicates an exact reference-bearing retry without generating a new time, quote, ID or storage write', async () => {
        const first = await appendWatchlistReview('00700.HK', input);
        const second = await appendWatchlistReview('0700.HK', { ...input, evidenceReferences: input.evidenceReferences?.map((ref) => ({ id: ref.id, kind: ref.kind })) });
        expect(first.success).toBe(true); expect(second.success).toBe(true);
        if (!first.success || !second.success) throw new Error('Exact evidence retry failed');
        expect(second).toMatchObject({ deduplicated: true, review: first.review });
        expect(second.entries).toEqual(first.entries);
        expect(mocks.update).toHaveBeenCalledTimes(1); expect(mocks.quote).toHaveBeenCalledTimes(1);
        expect(mocks.factExists).toHaveBeenCalledTimes(1); expect(mocks.comparisonExists).toHaveBeenCalledTimes(1);
        expect(rows[0].journal).toHaveLength(1);
    });
    it('returns the exact committed winner after a failed CAS response with evidence references intact', async () => {
        mocks.update.mockImplementationOnce(async (filter: Filter, change: Change) => { await update(filter, change); return null; });
        const result = await appendWatchlistReview('00700.HK', input);
        expect(result).toMatchObject({ success: true, deduplicated: true, review: { evidenceReferences: input.evidenceReferences } });
        if (!result.success) throw new Error('CAS retry did not recover committed review');
        expect(result.review).toEqual(rows[0].journal?.[0]);
        expect(result.entries).toEqual(rows[0].journal);
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });
    it('conflicts when the same request ID adds, removes or changes any evidence reference', async () => {
        const saved = await appendWatchlistReview('00700.HK', input); expect(saved.success).toBe(true);
        const before = structuredClone(rows[0]);
        for (const evidenceReferences of [[], [{ kind: 'fact' as const, id: 'different-fact' }], input.evidenceReferences?.slice(1)]) {
            expect(await appendWatchlistReview('00700.HK', { ...input, evidenceReferences })).toMatchObject({ success: false, code: 'CONFLICT' });
        }
        expect(rows[0]).toEqual(before); expect(mocks.update).toHaveBeenCalledTimes(1);
    });
    it('retains historical refs on exact retries after archive and evidence removal while blocking all new archived writes', async () => {
        const first = await appendWatchlistReview('00700.HK', input);
        if (!first.success) throw new Error('Initial append failed');
        rows[0].archivedAt = '2026-11-08T02:00:00Z'; facts.splice(0); comparisons.splice(0);
        const retried = await appendWatchlistReview('00700.HK', input);
        expect(retried).toMatchObject({ success: true, deduplicated: true, review: first.review });
        expect(await appendWatchlistReview('00700.HK', { ...input, clientRequestId: 'new-review' })).toMatchObject({ success: false, code: 'ARCHIVED' });
        expect(rows[0].journal).toHaveLength(1); expect(mocks.factExists).toHaveBeenCalledTimes(1);
    });
    it('rejects foreign or mismatched fact and comparison refs before quote reads and journal writes', async () => {
        for (const scenario of ['foreign-fact', 'wrong-fact-symbol', 'foreign-comparison', 'wrong-comparison-symbol']) {
            facts[0] = { userId: scenario === 'foreign-fact' ? 'other' : 'owner', id: factId, symbol: scenario === 'wrong-fact-symbol' ? 'AAPL' : '00700.HK' };
            comparisons[0] = { userId: scenario === 'foreign-comparison' ? 'other' : 'owner', id: comparisonId, symbols: [scenario === 'wrong-comparison-symbol' ? 'AAPL' : '00700.HK'] };
            expect(await appendWatchlistReview('00700.HK', input), scenario).toMatchObject({ success: false, code: 'INVALID_EVIDENCE' });
        }
        expect(mocks.quote).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(rows[0].journal).toEqual([]);
    });
    it('does not reuse a foreign journal request ID or accept correction references from a different owner', async () => {
        rows[0].userId = 'other';
        expect(await appendWatchlistReview('00700.HK', input)).toMatchObject({ success: false, code: 'NOT_FOUND' });
        rows.push(row());
        expect(await appendWatchlistReview('00700.HK', { ...input, correctionOf: 'other-review' })).toMatchObject({ success: false, code: 'INVALID_CORRECTION' });
        expect(mocks.factExists).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
    it('preserves original evidence when a correction explicitly supplies different references', async () => {
        const first = await appendWatchlistReview('00700.HK', input);
        if (!first.success) throw new Error('Initial append failed');
        const original = structuredClone(first.review);
        const result = await appendWatchlistReview('00700.HK', { ...input, clientRequestId: 'correction-review', correctionOf: first.review.id, evidenceReferences: [{ kind: 'fact', id: factId }] });
        expect(result).toMatchObject({ success: true, review: { correctionOf: first.review.id, evidenceReferences: [{ kind: 'fact', id: factId }] } });
        expect(rows[0].journal).toHaveLength(2); expect(rows[0].journal?.[0]).toEqual(original);
    });
    it('rejects injected and duplicate evidence before entering lifecycle coordination', async () => {
        await expect(appendWatchlistReview('00700.HK', { ...input, evidenceReferences: [{ kind: 'fact', id: factId, userId: 'other' }] } as never)).rejects.toThrow('引用');
        await expect(appendWatchlistReview('00700.HK', { ...input, evidenceReferences: [{ kind: 'fact', id: factId }, { kind: 'fact', id: factId }] })).rejects.toThrow('重复');
        expect(mocks.lifecycle).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
});
