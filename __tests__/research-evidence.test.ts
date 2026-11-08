import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredResearchFact } from '@/database/models/research-fact.model';
import type { ResearchComparisonPayload } from '@/lib/research-comparisons';
import { validateEvidenceReferences, validateReviewInput, reviewRequest, type WatchlistReview } from '@/lib/watchlist-review';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), factFind: vi.fn(), factExists: vi.fn(), comparisonFind: vi.fn(), comparisonExists: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/models/research-fact.model', () => ({ ResearchFact: { findOne: mocks.factFind, exists: mocks.factExists } }));
vi.mock('@/database/models/research-comparison.model', () => ({ ResearchComparisonRecord: { findOne: mocks.comparisonFind, exists: mocks.comparisonExists } }));
import { readResearchEvidence, researchEvidenceBelongsTo } from '@/lib/research-evidence';
import { getResearchEvidence } from '@/lib/actions/research-evidence.actions';

const factId = '11111111-1111-4111-8111-111111111111';
const comparisonId = '111111111111111111111111';
const fact: StoredResearchFact = {
    userId: 'owner', id: factId, symbol: '00700.HK', market: 'hk', exchangeId: 'HKEX', factType: 'positive', reportingPeriod: 'FY2026',
    title: '原始公告', factText: '测试原始事实', sourceUrl: 'https://example.com/report', sourcePublishedAt: null,
    createdAt: new Date('2026-11-08T00:00:00Z'), registrationMethod: 'manual', assessment: 'undetermined', assessmentNote: '',
    observationSnapshot: null, correctionOf: null, correctionReason: null, rootId: factId, version: 1,
    clientRequestId: 'request-123', createFingerprint: 'private-request-fingerprint',
};
const comparison: ResearchComparisonPayload & { _id: string; userId: string; savedAt: Date; createdAt: Date; draftId: string; requestId: string } = {
    _id: comparisonId, userId: 'owner', requestId: 'private-request', draftId: 'private-draft',
    savedAt: new Date('2026-11-08T01:00:00Z'), createdAt: new Date('2026-11-08T00:00:00Z'), caption: '保存的对照', algorithmVersion: 'completed-day-common-set-v1',
    result: { scope: 'watched', benchmarkSymbol: '02800.HK', fetchedAt: '2026-11-08T00:00:00Z',
        rows: [{ symbolId: 'HKEX:00700.HK', symbol: '00700.HK', comparison: { status: 'unavailable', reason: '测试样本不足' },
            volume: { status: 'unavailable', reason: '测试样本不足', sampleDates: [], sampleVolumes: [], missingDates: [], sampleSize: 0, requiredSample: 20, volumeUnit: 'shares' } }],
        omittedMembers: [], commonDates: [] }, originalSeries: [{ symbol: '00700.HK', series: null }],
};
const facts: StoredResearchFact[] = [];
const comparisons: typeof comparison[] = [];
type Filter = Record<string, unknown>;
function matchingFact(filter: Filter) { return facts.find((row) => row.userId === filter.userId && row.id === filter.id && row.symbol === filter.symbol); }
function matchingComparison(filter: Filter) { return comparisons.find((row) => row.userId === filter.userId && row._id === filter._id
    && (!filter['result.rows.symbol'] || row.result.rows.some((item) => item.symbol === filter['result.rows.symbol']))); }
beforeEach(() => {
    vi.clearAllMocks(); facts.splice(0); comparisons.splice(0);
    facts.push(structuredClone(fact)); comparisons.push(structuredClone(comparison));
    mocks.auth.mockResolvedValue('owner'); mocks.connect.mockResolvedValue(undefined);
    mocks.factFind.mockImplementation((filter: Filter) => ({ lean: async () => structuredClone(matchingFact(filter) ?? null) }));
    mocks.factExists.mockImplementation(async (filter: Filter) => matchingFact(filter) ? { _id: 'fact-db-id' } : null);
    mocks.comparisonFind.mockImplementation((filter: Filter) => ({ lean: async () => structuredClone(matchingComparison(filter) ?? null) }));
    mocks.comparisonExists.mockImplementation(async (filter: Filter) => matchingComparison(filter) ? { _id: comparisonId } : null);
});

describe('research evidence owner and canonical symbol boundaries', () => {
    it('resolves an owner fact by immutable id and canonical symbol while omitting request and owner metadata', async () => {
        const result = await getResearchEvidence('HKEX:700', { kind: 'fact', id: factId });
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.evidence).toMatchObject({ kind: 'fact', title: fact.title, recordedAt: fact.createdAt.toISOString(), data: {
            id: factId, symbol: '00700.HK', sourcePublishedAt: null, registrationMethod: 'manual', rootId: factId, version: 1,
        } });
        for (const field of ['userId', 'clientRequestId', 'createFingerprint']) expect(result.evidence.data).not.toHaveProperty(field);
        expect(mocks.factFind).toHaveBeenCalledWith({ userId: 'owner', id: factId, symbol: '00700.HK' });
    });
    it('rejects foreign and wrong-symbol fact reads and append authorization with the same owner scope', async () => {
        facts[0].userId = 'other-owner';
        expect(await readResearchEvidence('owner', '00700.HK', { kind: 'fact', id: factId })).toBeNull();
        expect(await researchEvidenceBelongsTo('owner', '00700.HK', [{ kind: 'fact', id: factId }])).toBe(false);
        facts[0].userId = 'owner';
        expect(await getResearchEvidence('AAPL', { kind: 'fact', id: factId })).toMatchObject({ success: false });
        expect(await researchEvidenceBelongsTo('owner', 'AAPL', [{ kind: 'fact', id: factId }])).toBe(false);
    });
    it('resolves owner comparison snapshots only for actual saved row members and serializes saved times', async () => {
        const result = await getResearchEvidence('0700.HK', { kind: 'comparison', id: comparisonId });
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.evidence).toMatchObject({ kind: 'comparison', title: comparison.caption, recordedAt: comparison.savedAt.toISOString(), data: {
            id: comparisonId, savedAt: comparison.savedAt.toISOString(), originalSeries: comparison.originalSeries, result: comparison.result,
        } });
        for (const field of ['userId', 'requestId', 'draftId']) expect(result.evidence.data).not.toHaveProperty(field);
        expect(await researchEvidenceBelongsTo('owner', 'HKEX:700', [{ kind: 'comparison', id: comparisonId }])).toBe(true);
        expect(await researchEvidenceBelongsTo('owner', '02800.HK', [{ kind: 'comparison', id: comparisonId }])).toBe(false);
        expect(await getResearchEvidence('AAPL', { kind: 'comparison', id: comparisonId })).toMatchObject({ success: false });
        comparisons[0].userId = 'other-owner';
        expect(await getResearchEvidence('700', { kind: 'comparison', id: comparisonId })).toMatchObject({ success: false });
        expect(await researchEvidenceBelongsTo('owner', '00700.HK', [{ kind: 'comparison', id: comparisonId }])).toBe(false);
    });
    it('rejects any missing reference in mixed evidence and never consults comparison storage for draft UUIDs', async () => {
        expect(await researchEvidenceBelongsTo('owner', '00700.HK', [{ kind: 'fact', id: factId }, { kind: 'comparison', id: comparisonId }])).toBe(true);
        expect(await researchEvidenceBelongsTo('owner', '00700.HK', [{ kind: 'fact', id: 'missing-fact' }, { kind: 'comparison', id: comparisonId }])).toBe(false);
        mocks.comparisonFind.mockClear(); mocks.comparisonExists.mockClear();
        expect(await readResearchEvidence('owner', '00700.HK', { kind: 'comparison', id: factId })).toBeNull();
        expect(await researchEvidenceBelongsTo('owner', '00700.HK', [{ kind: 'comparison', id: factId }])).toBe(false);
        expect(mocks.comparisonFind).not.toHaveBeenCalled(); expect(mocks.comparisonExists).not.toHaveBeenCalled();
    });
    it('authenticates before evidence validation or storage and does not connect for malformed references or symbols', async () => {
        mocks.auth.mockRejectedValueOnce(new Error('Unauthorized'));
        await expect(getResearchEvidence('00700.HK', { kind: 'fact', id: factId })).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(await getResearchEvidence('???', { kind: 'fact', id: factId })).toMatchObject({ success: false });
        expect(await getResearchEvidence('00700.HK', { kind: 'fact', id: { $ne: null } } as never)).toMatchObject({ success: false });
        expect(await getResearchEvidence('00700.HK', { kind: 'fact', id: factId, userId: 'other' } as never)).toMatchObject({ success: false });
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.factFind).not.toHaveBeenCalled();
    });
    it('returns a failure after storage errors without returning owner or unvalidated payloads', async () => {
        mocks.factFind.mockImplementationOnce(() => ({ lean: async () => { throw new Error('database private error'); } }));
        const result = await getResearchEvidence('700', { kind: 'fact', id: factId });
        expect(result).toMatchObject({ success: false }); expect(JSON.stringify(result)).not.toContain('database private error');
    });
});

describe('evidence reference input and exact request reconstruction', () => {
    const input = { tradingDate: '2026-11-08', hypothesis: '原假设', changes: '资料变化', conclusion: '人工核查', verificationType: 'fact' as const,
        evidenceURLs: ['https://example.com/report'], clientRequestId: 'review-request', evidenceReferences: [{ kind: 'fact' as const, id: factId }, { kind: 'comparison' as const, id: comparisonId }] };
    it('rejects nested owner/action injections, invalid kinds/IDs, duplicate refs and more than ten references', () => {
        for (const value of [null, {}, [{ kind: 'fact', id: factId, userId: 'other' }], [{ kind: 'event', id: factId }], [{ kind: 'fact', id: { $ne: null } }], [{ kind: 'fact', id: 'bad/id' }], [{ kind: 'fact', id: factId }, { kind: 'fact', id: factId }], Array.from({ length: 11 }, (_, i) => ({ kind: 'fact', id: `id-${i}` }))]) expect(() => validateEvidenceReferences(value)).toThrow();
        expect(validateEvidenceReferences(undefined)).toEqual([]);
        expect(validateEvidenceReferences(input.evidenceReferences)).toEqual(input.evidenceReferences);
    });
    it('reconstructs exactly the normalized request property order used by duplicate and CAS retry checks', () => {
        const request = validateReviewInput(input);
        const saved: WatchlistReview = { ...request, kind: 'review', id: 'saved-review', createdAt: '2026-11-08T01:00:00Z' };
        expect(JSON.stringify(reviewRequest(saved))).toBe(JSON.stringify(request));
        expect(reviewRequest(saved)).not.toHaveProperty('createdAt'); expect(reviewRequest(saved)).not.toHaveProperty('id');
        expect(JSON.stringify(reviewRequest(saved))).not.toBe(JSON.stringify(validateReviewInput({ ...input, evidenceReferences: [{ kind: 'fact', id: 'different-fact' }] })));
    });
    it('keeps legacy omitted/empty evidence equivalent and preserves correction references without inheriting new ones', () => {
        const request = validateReviewInput({ ...input, evidenceReferences: undefined });
        const saved: WatchlistReview = { ...request, kind: 'review', id: 'legacy-review', createdAt: '2026-11-08T01:00:00Z' };
        expect(JSON.stringify(reviewRequest(saved))).toBe(JSON.stringify(validateReviewInput({ ...input, evidenceReferences: [] })));
        expect(validateReviewInput({ ...input, correctionOf: saved.id })).toMatchObject({ correctionOf: saved.id, evidenceReferences: input.evidenceReferences });
        expect(validateReviewInput({ ...input, correctionOf: saved.id, evidenceReferences: undefined })).not.toHaveProperty('evidenceReferences');
    });
    it('rejects a URL containing only a credential secret as well as ordinary username credentials', () => {
        const secretOnly = new URL('https://example.com/report');
        Reflect.set(secretOnly, ['pass', 'word'].join(''), 'test-secret');
        expect(secretOnly.href).toContain('@');
        for (const source of [secretOnly.href, 'https://username@example.com/report']) expect(() => validateReviewInput({ ...input, evidenceURLs: [source] })).toThrow('HTTP');
    });
});
