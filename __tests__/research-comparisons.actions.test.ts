import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResearchComparison } from '@/database/models/research-comparison.model';
import type { DailyResearchResult } from '@/lib/market/daily-research';
import type { ObservationRevision } from '@/lib/watchlist-review';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), findOne: vi.fn(), create: vi.fn(), find: vi.fn(), aggregate: vi.fn(), lifecycle: vi.fn(), history: vi.fn(), locked: false }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/database/models/research-comparison.model', () => ({ ResearchComparisonRecord: { findOne: mocks.findOne, create: mocks.create, find: mocks.find } }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { aggregate: mocks.aggregate } }));
vi.mock('@/lib/watchlist-lifecycle', () => ({ withWatchlistLifecycle: mocks.lifecycle }));
vi.mock('@/lib/actions/relative-history.actions', () => ({ getDailyResearch: mocks.history }));
import { comparisonDrafts, DAILY_RESEARCH_ALGORITHM_VERSION, type SaveResearchComparisonInput } from '@/lib/research-comparisons';
import { getComparisonObservation, getDailyResearchDraft, getResearchComparison, listResearchComparisons, saveResearchComparison } from '@/lib/actions/research-comparisons.actions';
const id = 'abcdef012345678901234567';
const result: DailyResearchResult = { scope: 'watched', benchmarkSymbol: '510300.SS', fetchedAt: '2026-11-08T00:00:00Z', commonDates: [], omittedMembers: [{ symbol: 'AAPL', symbolId: 'US:AAPL' }], rows: [{
    symbol: '000001.SZ', symbolId: 'SZSE:000001.SZ', comparison: { status: 'unavailable', reason: '来源失败' },
    volume: { status: 'unavailable', reason: '来源失败', sampleDates: [], sampleVolumes: [], missingDates: [], sampleSize: 0, requiredSample: 20, volumeUnit: 'shares' },
}] };
const original: ObservationRevision = { kind: 'observation', id: 'revision-1', recordedAt: '2026-11-07T00:00:00Z', modifiedAt: null, source: 'legacy-capture', observation: { reviewStatus: 'watching', note: '原判断不可静默改写' } };
function input(): SaveResearchComparisonInput {
    return { draftId: comparisonDrafts.issue('owner-a', result, [{ symbol: '000001.SZ', series: null }, { symbol: '510300.SS', series: null }]).id, requestId: crypto.randomUUID(), caption: '暂时没有足够样本' };
}
function row(command: SaveResearchComparisonInput): IResearchComparison {
    return { _id: id as unknown as IResearchComparison['_id'], userId: 'owner-a', requestId: command.requestId, draftId: command.draftId,
        caption: command.caption, createdAt: new Date(), savedAt: new Date(), result: structuredClone(result), originalSeries: [], algorithmVersion: DAILY_RESEARCH_ALGORITHM_VERSION,
        ...(command.observationReference ? { observationReference: command.observationReference, originalObservation: original } : {}) };
}
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T00:00:00Z'));
    mocks.auth.mockResolvedValue('owner-a'); mocks.connect.mockResolvedValue(undefined);
    mocks.findOne.mockReturnValue({ lean: async () => null });
    mocks.create.mockImplementation(async payload => ({ _id: id, ...payload }));
    mocks.locked = false;
    mocks.lifecycle.mockImplementation(async (_owner: string, _intent: unknown, callback: () => Promise<unknown>) => {
        mocks.locked = true;
        try { return await callback(); } finally { mocks.locked = false; }
    });
    mocks.aggregate.mockResolvedValue([original]);
});
afterEach(() => vi.useRealTimers());
describe('immutable saved daily comparison actions', () => {
    it('authenticates before any read, write or upstream request and returns production-safe errors', async () => {
        mocks.auth.mockRejectedValue(new Error('secret session/database detail'));
        const responses = await Promise.all([saveResearchComparison(input()), getResearchComparison(id), listResearchComparisons(), getComparisonObservation('draft', '000001.SZ')]);
        expect(responses.every(response => !response.ok && response.error.code === 'REQUEST_FAILED')).toBe(true);
        expect(JSON.stringify(responses)).not.toContain('secret'); expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
    it('saves exact displayed data plus original null failures without refetching or requiring active membership', async () => {
        const response = await saveResearchComparison(input());
        expect(response).toMatchObject({ ok: true, value: { id, result, caption: '暂时没有足够样本', algorithmVersion: DAILY_RESEARCH_ALGORITHM_VERSION, originalSeries: [{ symbol: '000001.SZ', series: null }, { symbol: '510300.SS', series: null }] } });
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner-a', savedAt: new Date(), createdAt: new Date() }));
        expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.aggregate).not.toHaveBeenCalled(); expect(mocks.lifecycle).not.toHaveBeenCalled();
    });
    it('rejects forged numerical evidence, arbitrary owner, and foreign drafts before writes', async () => {
        const command = input();
        expect(await saveResearchComparison({ ...command, result: { forged: true } } as SaveResearchComparisonInput)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        const other = comparisonDrafts.issue('other', result, []);
        expect(await saveResearchComparison({ ...command, draftId: other.id })).toMatchObject({ ok: false, error: { code: 'DRAFT_EXPIRED' } });
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('returns an existing save for an identical retry even after its draft expires', async () => {
        const command = input(); const saved = row(command);
        vi.advanceTimersByTime(31 * 60_000); mocks.findOne.mockReturnValue({ lean: async () => saved });
        expect(await saveResearchComparison(command)).toMatchObject({ ok: true, value: { id } });
        expect(mocks.create).not.toHaveBeenCalled();
        expect(await saveResearchComparison({ ...command, caption: '改写旧证据' })).toMatchObject({ ok: false, error: { code: 'REQUEST_CONFLICT' } });
    });
    it('returns a safe expired response and never substitutes a fresh fetch', async () => {
        const command = input(); vi.advanceTimersByTime(31 * 60_000);
        expect(await saveResearchComparison(command)).toMatchObject({ ok: false, error: { code: 'DRAFT_EXPIRED' } });
        expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
    it('deduplicates a concurrent unique-index winner and detects changed request reuse', async () => {
        const command = input(); const saved = row(command);
        mocks.findOne.mockReturnValueOnce({ lean: async () => null }).mockReturnValueOnce({ lean: async () => saved });
        mocks.create.mockRejectedValueOnce({ code: 11000 });
        expect(await saveResearchComparison(command)).toMatchObject({ ok: true, value: { id } });
        mocks.findOne.mockReturnValue({ lean: async () => ({ ...saved, draftId: 'different-draft' }) });
        expect(await saveResearchComparison(command)).toMatchObject({ ok: false, error: { code: 'REQUEST_CONFLICT' } });
    });
    it('keeps unexpected database failures serialized without exposing internals', async () => {
        mocks.create.mockRejectedValue(new Error('mongodb://private-host/credentials'));
        const response = await saveResearchComparison(input());
        expect(response).toMatchObject({ ok: false, error: { code: 'REQUEST_FAILED' } }); expect(JSON.stringify(response)).not.toContain('private-host');
    });
    it('scopes get and paginated lists to owner, with stable id cursor and bounded summaries', async () => {
        const saved = row(input()); mocks.findOne.mockReturnValue({ lean: async () => saved });
        expect(await getResearchComparison(id)).toMatchObject({ ok: true, value: { id } });
        expect(mocks.findOne).toHaveBeenCalledWith({ _id: id, userId: 'owner-a' });
        mocks.find.mockReturnValue({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [saved, { ...saved, _id: 'bbbbbb012345678901234567' }] }) }) }) });
        const page = await listResearchComparisons({ cursor: id, limit: 1, symbol: '000001.SZ' });
        expect(page).toMatchObject({ ok: true, value: { nextCursor: id, entries: [{ id, symbols: ['000001.SZ'] }] } });
        expect(mocks.find).toHaveBeenCalledWith({ userId: 'owner-a', _id: { $lt: id }, 'result.rows.symbolId': 'SZSE:000001.SZ' });
        if (page.ok) expect(Object.hasOwn(page.value.entries[0], 'originalSeries')).toBe(false);
        expect(await listResearchComparisons({ limit: 51 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
        expect(await getResearchComparison('$ne')).toMatchObject({ ok: false, error: { code: 'INVALID_ID' } });
    });
    it('hides foreign or nonexistent saved evidence', async () => {
        expect(await getResearchComparison(id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });
    it('loads an optional original only from the owner journal and the displayed members', async () => {
        const command = input();
        expect(await getComparisonObservation(command.draftId, '000001.SZ')).toMatchObject({ ok: true, value: { reference: { symbolId: 'SZSE:000001.SZ', observationId: original.id, version: original.recordedAt }, original } });
        expect(mocks.aggregate.mock.calls[0][0][0].$match).toMatchObject({ userId: 'owner-a' });
        expect(await getComparisonObservation(command.draftId, 'AAPL')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });
    it('warns about changed judgment and retains the old revision only after explicit confirmation', async () => {
        const command = { ...input(), observationReference: { symbolId: 'SZSE:000001.SZ', observationId: original.id, version: original.recordedAt } };
        mocks.aggregate.mockResolvedValueOnce([original]).mockResolvedValueOnce([{ ...original, id: 'revision-2' }]);
        expect(await saveResearchComparison(command)).toMatchObject({ ok: false, error: { code: 'RESEARCH_CHANGED' } });
        expect(mocks.create).not.toHaveBeenCalled();
        mocks.aggregate.mockResolvedValueOnce([original]).mockResolvedValueOnce([{ ...original, id: 'revision-2' }]);
        expect(await saveResearchComparison({ ...command, confirmOriginalObservation: true })).toMatchObject({ ok: true, value: { observationReference: command.observationReference, originalObservation: original } });
    });
    it('loads and saves actual Mixed-style null optional judgment fields as absent without a refetch', async () => {
        const raw = { ...original, observation: { ...original.observation, group: null, invalidation: null, targetPrice: null, reviewedAt: null, nextReviewDate: null, proximityPercent: 0 } };
        mocks.aggregate.mockResolvedValue([raw]);
        const command = input();
        const choice = await getComparisonObservation(command.draftId, '000001.SZ');
        expect(choice).toMatchObject({ ok: true, value: { original: { observation: { reviewStatus: 'watching', note: original.observation.note, proximityPercent: 0 } } } });
        if (!choice.ok) throw new Error('expected original observation');
        const saved = await saveResearchComparison({ ...command, observationReference: choice.value.reference });
        expect(saved).toMatchObject({ ok: true, value: { originalObservation: { observation: { reviewStatus: 'watching', note: original.observation.note, proximityPercent: 0 } } } });
        if (saved.ok) expect(Object.hasOwn(saved.value.originalObservation!.observation, 'targetPrice')).toBe(false);
        expect(raw.observation.targetPrice).toBeNull(); expect(mocks.history).not.toHaveBeenCalled();
    });
    it('keeps the version check and evidence insert under the same owner lock', async () => {
        const command = { ...input(), observationReference: { symbolId: 'SZSE:000001.SZ', observationId: original.id, version: original.recordedAt } };
        mocks.aggregate.mockImplementation(async () => { expect(mocks.locked).toBe(true); return [original]; });
        mocks.create.mockImplementationOnce(async payload => { expect(mocks.locked).toBe(true); return { ...payload, _id: id }; });
        expect(await saveResearchComparison(command)).toMatchObject({ ok: true, value: { id } });
        expect(mocks.locked).toBe(false);
    });
    it('rejects missing/foreign revisions and mismatching original versions without inventing a journal', async () => {
        const command = { ...input(), observationReference: { symbolId: 'SZSE:000001.SZ', observationId: original.id, version: original.recordedAt } };
        mocks.aggregate.mockResolvedValueOnce([]);
        expect(await saveResearchComparison(command)).toMatchObject({ ok: false, error: { code: 'INVALID_REFERENCE' } });
        expect(await saveResearchComparison({ ...command, observationReference: { ...command.observationReference, version: '2026-11-01T00:00:00Z' } })).toMatchObject({ ok: false, error: { code: 'INVALID_REFERENCE' } });
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('wraps new daily fetch requests in serialized results', async () => {
        mocks.history.mockResolvedValueOnce({ ...result, draft: { id: 'issued', expiresAt: '2026-11-08T00:30:00Z' } });
        expect(await getDailyResearchDraft({ scope: 'watched', benchmarkSymbol: '510300.SS' })).toMatchObject({ ok: true, value: { draft: { id: 'issued' } } });
        mocks.history.mockRejectedValueOnce(new Error('private upstream error'));
        expect(await getDailyResearchDraft({ scope: 'watched', benchmarkSymbol: '510300.SS' })).toMatchObject({ ok: false, error: { code: 'REQUEST_FAILED' } });
    });
});
