import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredResearchFact } from '@/database/models/research-fact.model';
import type { CreateResearchFactInput } from '@/lib/research-facts';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), findOne: vi.fn(), find: vi.fn(), create: vi.fn(), observationOne: vi.fn(), observations: vi.fn(), watchlistWrite: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/models/research-fact.model', () => ({ ResearchFact: { findOne: mocks.findOne, find: mocks.find, create: mocks.create } }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { findOne: mocks.observationOne, find: mocks.observations, updateOne: mocks.watchlistWrite, create: mocks.watchlistWrite } }));
import {
    createResearchFact, getFactObservationChoices, getResearchFactById, getResearchFacts,
    createResearchFactForUI, getFactObservationChoicesForUI, getResearchFactByIdForUI, getResearchFactsForUI,
} from '@/lib/actions/research-facts.actions';

const input: CreateResearchFactInput = { symbol: 'HKEX:700', factType: 'positive', reportingPeriod: 'FY2026 中期', title: '公告原文', factText: '公司预计利润改善，尚需核查盈利口径', sourceUrl: 'https://example.com/report', sourcePublishedAt: null, assessment: 'undetermined', assessmentNote: '核查利润率', clientRequestId: 'request-1234' };
const facts: StoredResearchFact[] = [];
type Observation = { _id: string; userId: string; symbol: string; journalVersion: number; note: string; invalidation: string; reviewStatus: 'watching'; archivedAt?: Date; observationUpdatedAt?: Date; journal: { kind: 'observation'; id: string; recordedAt: string; modifiedAt: string | null; source: 'edit'; observation: { note: string; reviewStatus: 'watching' } }[] };
const observations: Observation[] = [];
type Filter = Record<string, unknown>;
function match(fact: StoredResearchFact, filter: Filter): boolean {
    return fact.userId === filter.userId && (!filter.id || fact.id === filter.id)
        && (!filter.symbol || fact.symbol === filter.symbol) && (!filter.clientRequestId || fact.clientRequestId === filter.clientRequestId)
        && (!filter.correctionOf || fact.correctionOf === filter.correctionOf);
}
function observationMatches(record: Observation, filter: Filter): boolean {
    const symbols = (filter.symbol as { $in: string[] })?.$in ?? [];
    return record.userId === filter.userId && (!filter._id || filter._id === record._id) && symbols.includes(record.symbol);
}
beforeEach(() => {
    vi.clearAllMocks(); facts.splice(0); observations.splice(0);
    mocks.auth.mockResolvedValue('user-a'); mocks.connect.mockResolvedValue(undefined);
    mocks.findOne.mockImplementation((filter: Filter) => ({ lean: async () => structuredClone(facts.find((fact) => match(fact, filter)) ?? null) }));
    mocks.create.mockImplementation(async (fact: StoredResearchFact) => {
        if (facts.some((saved) => saved.userId === fact.userId && (saved.id === fact.id || saved.clientRequestId === fact.clientRequestId || (fact.correctionOf && saved.correctionOf === fact.correctionOf)))) throw { code: 11000 };
        facts.push(structuredClone(fact)); return structuredClone(fact);
    });
    mocks.find.mockImplementation((filter: Filter) => {
        let limit = 0;
        const query = { sort: vi.fn().mockImplementation(() => query), limit: vi.fn().mockImplementation((value: number) => { limit = value; return query; }), lean: async () => {
            const after = filter.$or as [{ createdAt: { $lt: Date } }, { createdAt: Date; id: { $lt: string } }] | undefined;
            return structuredClone(facts.filter((fact) => match(fact, filter) && (!after || fact.createdAt < after[0].createdAt.$lt || (+fact.createdAt === +after[1].createdAt && fact.id < after[1].id.$lt)))
                .sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id)).slice(0, limit));
        } }; return query;
    });
    mocks.observations.mockImplementation((filter: Filter) => {
        const query = { select: () => query, slice: () => query, limit: () => query, lean: async () => structuredClone(observations.filter((record) => observationMatches(record, filter))) }; return query;
    });
    mocks.observationOne.mockImplementation((filter: Filter) => ({ select: () => ({ lean: async () => structuredClone(observations.find((record) => observationMatches(record, filter)) ?? null) }) }));
});
function addObservation(archived = false): Observation {
    const record: Observation = { _id: '111111111111111111111111', userId: 'user-a', symbol: 'HKEX:700', journalVersion: 4,
        note: '当前原判断', invalidation: '利润率下降', reviewStatus: 'watching', observationUpdatedAt: new Date('2026-11-07T01:00:00Z'),
        ...(archived ? { archivedAt: new Date('2026-11-07T02:00:00Z') } : {}),
        journal: [{ kind: 'observation', id: 'original-observation', source: 'edit', recordedAt: '2026-11-01T01:00:00Z', modifiedAt: null, observation: { note: '最初盈利改善判断', reviewStatus: 'watching' } }] };
    observations.push(record); return record;
}
describe('owner isolated append-only fact actions', () => {
    it('authenticates every entry point before querying or connecting', async () => {
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        await expect(createResearchFact(input)).rejects.toThrow('Unauthorized');
        await expect(getResearchFacts()).rejects.toThrow('Unauthorized');
        await expect(getResearchFactById('11111111-1111-4111-8111-111111111111')).rejects.toThrow('Unauthorized');
        await expect(getFactObservationChoices('AAPL')).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
    it('saves an unwatched canonical fact with unknown publication time and server manual registration time', async () => {
        const before = Date.now(); const saved = await createResearchFact(input);
        expect(saved).toMatchObject({ symbol: '00700.HK', market: 'hk', exchangeId: 'HKEX', sourcePublishedAt: null, registrationMethod: 'manual', observationSnapshot: null, version: 1, rootId: saved.id });
        expect(Date.parse(saved.createdAt)).toBeGreaterThanOrEqual(before);
        for (const key of ['userId', 'clientRequestId', 'createFingerprint', 'fetchedAt', 'reviewStatus']) expect(saved).not.toHaveProperty(key);
        expect(mocks.observationOne).not.toHaveBeenCalled(); expect(mocks.watchlistWrite).not.toHaveBeenCalled();
    });
    it('isolates lists, request IDs, correction parents and evidence lookup by owner and canonical symbol', async () => {
        const first = await createResearchFact(input); facts[0].userId = 'user-b';
        expect((await getResearchFacts()).facts).toEqual([]);
        expect(await getResearchFactById(first.id)).toBeNull();
        await expect(createResearchFact({ ...input, correctionOf: first.id, correctionReason: '改正' })).rejects.toThrow('原事实');
        const own = await createResearchFact(input); expect(own.id).not.toBe(first.id);
        expect(await getResearchFactById(own.id, 'AAPL')).toBeNull();
        expect(await getResearchFactById(own.id, '0700.HK')).toEqual(own);
        expect(mocks.findOne).toHaveBeenCalledWith({ userId: 'user-a', id: own.id, symbol: '00700.HK' });
    });
    it('deduplicates canonical retries and concurrent first creates, rejecting request-content reuse', async () => {
        const [a, b] = await Promise.all([createResearchFact(input), createResearchFact({ ...input, symbol: '0700.HK' })]);
        expect(a).toEqual(b); expect(facts).toHaveLength(1);
        await expect(createResearchFact({ ...input, factText: '另一条原文' })).rejects.toThrow('请求标识');
        expect(facts).toHaveLength(1);
    });
    it('preserves originals, correction chains and retry fingerprints and prevents simultaneous correction forks', async () => {
        const original = await createResearchFact(input);
        const correctionInput = { ...input, factText: '更正后的原文', correctionOf: original.id, correctionReason: '原摘录遗漏范围', clientRequestId: 'correction-request' };
        const results = await Promise.allSettled([createResearchFact(correctionInput), createResearchFact({ ...correctionInput, clientRequestId: 'other-correction' })]);
        const winning = results.find((result) => result.status === 'fulfilled');
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(winning?.status === 'fulfilled' && winning.value).toMatchObject({ rootId: original.id, correctionOf: original.id, version: 2 });
        expect(await createResearchFact(input)).toEqual(original);
        expect(await getResearchFactById(original.id)).toEqual(original);
        expect(facts[0].factText).toBe(input.factText);
        const latest = facts.find((fact) => fact.version === 2)!;
        const third = await createResearchFact({ ...correctionInput, correctionOf: latest.id, clientRequestId: 'third-correction' });
        expect(third).toMatchObject({ rootId: original.id, correctionOf: latest.id, version: 3 });
        expect(facts).toHaveLength(3);
    });
    it('returns the existing correction if an identical concurrent retry wins between dedup and successor reads', async () => {
        const original = await createResearchFact(input);
        const correctionInput = { ...input, clientRequestId: 'same-correction-request', correctionOf: original.id, correctionReason: '补充原文' };
        const implementation = mocks.findOne.getMockImplementation()!;
        let raced = false;
        mocks.findOne.mockImplementation((filter: Filter) => {
            if (filter.correctionOf && !raced) {
                raced = true;
                return { lean: async () => {
                    await createResearchFact(correctionInput);
                    return structuredClone(facts.find((fact) => match(fact, filter)) ?? null);
                } };
            }
            return implementation(filter);
        });
        const saved = await createResearchFact(correctionInput);
        expect(saved).toMatchObject({ correctionOf: original.id, version: 2 });
        expect(facts).toHaveLength(2);
        expect(await createResearchFact(correctionInput)).toEqual(saved);
    });
    it('captures owner-validated active and archived current states and immutable historical revisions', async () => {
        for (const archived of [false, true]) {
            observations.splice(0); const record = addObservation(archived);
            const choices = await getFactObservationChoices('00700.HK'); expect(choices).toHaveLength(2);
            const saved = await createResearchFact({ ...input, clientRequestId: `snapshot-${archived}`, observationReference: choices[1].reference });
            expect(saved.observationSnapshot).toMatchObject({ recordId: record._id, revisionId: 'original-observation', journalVersion: 4, observationUpdatedAt: null, observation: { note: '最初盈利改善判断' } });
            expect(saved.observationSnapshot?.archivedAt).toBe(archived ? record.archivedAt!.toISOString() : null);
            record.journal[0].observation.note = '后来修改的内容'; record.note = '后来原文';
            expect((await getResearchFactById(saved.id))?.observationSnapshot?.observation.note).toBe('最初盈利改善判断');
        }
        expect(mocks.watchlistWrite).not.toHaveBeenCalled();
    });
    it('rejects foreign, wrong-symbol, missing-revision and stale observation references before inserting', async () => {
        const record = addObservation(true); const [current, historical] = await getFactObservationChoices('00700.HK');
        record.userId = 'user-b';
        await expect(createResearchFact({ ...input, observationReference: current.reference })).rejects.toThrow('原判断');
        record.userId = 'user-a'; record.symbol = 'AAPL';
        await expect(createResearchFact({ ...input, observationReference: current.reference })).rejects.toThrow('原判断');
        record.symbol = 'HKEX:700'; record.note = '用户已更改观点';
        await expect(createResearchFact({ ...input, observationReference: current.reference })).rejects.toThrow('版本已变化');
        record.journal = [];
        await expect(createResearchFact({ ...input, observationReference: historical.reference })).rejects.toThrow('版本');
        expect(facts).toHaveLength(0);
    });
    it('captures long original legacy history verbatim and refuses an oversized UTF8 snapshot before a write', async () => {
        const record = addObservation();
        const originalNote = `${'甲'.repeat(2000)}\n\n${'乙'.repeat(2000)}`;
        record.journal[0].observation.note = originalNote;
        let choices = await getFactObservationChoices('700');
        const saved = await createResearchFactForUI({ ...input, observationReference: choices[1].reference });
        expect(saved.ok && saved.value.observationSnapshot?.observation.note).toBe(originalNote);
        record.journal[0].observation.note = '界'.repeat(4 * 1024 * 1024);
        choices = await getFactObservationChoices('700');
        mocks.create.mockClear();
        expect(await createResearchFactForUI({ ...input, clientRequestId: 'oversized-snapshot', observationReference: choices[1].reference })).toMatchObject({ ok: false, error: { code: 'CAPACITY', message: expect.stringContaining('原文与输入仍保留') } });
        expect(mocks.create).not.toHaveBeenCalled(); expect(facts).toHaveLength(1);
        expect(record.journal[0].observation.note).toHaveLength(4 * 1024 * 1024);
    });
    it('inherits the exact original observation snapshot when correcting after the observation changed', async () => {
        const observation = addObservation(); const [current] = await getFactObservationChoices('700');
        const saved = await createResearchFact({ ...input, observationReference: current.reference });
        observation.note = '新的观点'; observation.journalVersion++;
        expect(await createResearchFact({ ...input, observationReference: current.reference })).toEqual(saved);
        const correction = await createResearchFact({ ...input, clientRequestId: 'correct-snapshot', correctionOf: saved.id, correctionReason: '改正原文', factText: '修订原文' });
        expect(correction.observationSnapshot).toEqual(saved.observationSnapshot);
    });
    it('keyset-pages equal-time facts without duplicates and rejects unbounded limits and invalid cursors', async () => {
        for (let i = 0; i < 5; i++) await createResearchFact({ ...input, clientRequestId: `request-${i}` });
        facts.forEach((fact) => fact.createdAt = new Date('2026-11-08T01:00:00Z'));
        const first = await getResearchFacts({ limit: 2 });
        const second = await getResearchFacts({ limit: 2, cursor: first.nextCursor });
        const third = await getResearchFacts({ limit: 2, cursor: second.nextCursor });
        expect(new Set([...first.facts, ...second.facts, ...third.facts].map((fact) => fact.id)).size).toBe(5);
        expect(third.nextCursor).toBeUndefined();
        for (const limit of [0, 51, NaN, 1.5]) await expect(getResearchFacts({ limit })).rejects.toThrow('每页');
        await expect(getResearchFacts({ cursor: 'broken' })).rejects.toThrow('游标');
        await expect(getResearchFacts({ symbol: 'AAPL', cursor: first.nextCursor })).rejects.toThrow('游标');
    });
    it('returns serializable public success envelopes without changing the internal APIs', async () => {
        const result = await createResearchFactForUI(input);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('Expected success');
        expect(await createResearchFact(input)).toEqual(result.value);
        expect(await getResearchFactByIdForUI(result.value.id)).toEqual({ ok: true, value: result.value });
        expect(await getResearchFactsForUI()).toEqual({ ok: true, value: { facts: [result.value] } });
        expect(await getFactObservationChoicesForUI('700')).toEqual({ ok: true, value: [] });
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });
    it('returns actionable public stale-observation and missing-version messages instead of throwing server errors', async () => {
        const record = addObservation(); const [current, historical] = await getFactObservationChoices('700');
        record.note = '后来的观点';
        const stale = await createResearchFactForUI({ ...input, observationReference: current.reference });
        expect(stale).toEqual({ ok: false, error: { code: 'STALE_OBSERVATION', message: '原判断版本已变化，请重新读取并选择；输入仍保留。' } });
        expect(JSON.parse(JSON.stringify(stale))).toEqual(stale);
        record.journal = [];
        expect(await createResearchFactForUI({ ...input, observationReference: historical.reference })).toMatchObject({ ok: false, error: { code: 'OBSERVATION_NOT_FOUND', message: expect.stringContaining('重新读取') } });
        expect(facts).toHaveLength(0);
    });
    it('returns safe correction/request conflicts and missing-parent errors while preserving original records', async () => {
        const original = await createResearchFact(input);
        const correction = { ...input, correctionOf: original.id, correctionReason: '改正遗漏', clientRequestId: 'public-correction' };
        const saved = await createResearchFactForUI(correction); expect(saved.ok).toBe(true);
        expect(await createResearchFactForUI({ ...correction, clientRequestId: 'another-public-correction' })).toMatchObject({ ok: false, error: { code: 'CORRECTION_CONFLICT', message: expect.stringContaining('重新读取最新事实') } });
        expect(await createResearchFactForUI({ ...input, factText: '另一原文' })).toMatchObject({ ok: false, error: { code: 'REQUEST_CONFLICT' } });
        expect(await createResearchFactForUI({ ...correction, correctionOf: '22222222-2222-4222-8222-222222222222', clientRequestId: 'missing-parent' })).toMatchObject({ ok: false, error: { code: 'PARENT_NOT_FOUND' } });
        expect(await getResearchFactById(original.id)).toEqual(original); expect(facts).toHaveLength(2);
    });
    it('returns static invalid-input envelopes for every public action before persistence', async () => {
        for (const result of [
            await createResearchFactForUI({ ...input, sourceUrl: 'javascript:alert(1)' }),
            await getFactObservationChoicesForUI('???'),
            await getResearchFactByIdForUI('$injected'),
            await getResearchFactsForUI({ limit: 51 }),
        ]) expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringContaining('输入仍保留') } });
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
    it('sanitizes arbitrary database/auth errors from all public endpoints without trusting their message or code fields', async () => {
        const sensitive = new Error('database secret URI and raw duplicate key');
        Object.assign(sensitive, { code: 'STALE_OBSERVATION' });
        mocks.connect.mockRejectedValue(sensitive);
        for (const result of [
            await createResearchFactForUI(input), await getFactObservationChoicesForUI('700'),
            await getResearchFactByIdForUI('11111111-1111-4111-8111-111111111111'), await getResearchFactsForUI(),
        ]) {
            expect(result).toEqual({ ok: false, error: { code: 'UNAVAILABLE', message: '事实操作暂时失败，请重新读取核对后重试；已显示资料与输入仍保留。' } });
            expect(JSON.stringify(result)).not.toContain('secret');
        }
        mocks.connect.mockReset(); mocks.auth.mockRejectedValue(new Error('private auth/session details'));
        expect(await createResearchFactForUI(input)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
    it('rejects URL/time and owner injections before touching persistence', async () => {
        await expect(createResearchFact({ ...input, sourceUrl: 'javascript:alert(1)' })).rejects.toThrow('HTTP');
        await expect(createResearchFact({ ...input, sourcePublishedAt: '2026-02-30T00:00:00Z' })).rejects.toThrow('时间');
        await expect(createResearchFact({ ...input, userId: 'user-b' } as CreateResearchFactInput)).rejects.toThrow('字段');
        expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
});
