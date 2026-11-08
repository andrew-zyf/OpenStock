import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchEventHistory, ResearchChangeState } from '@/database/models/research-change.model';
import type { MarketEvent } from '@/lib/market/events';
import type { ObservationRevision, WatchlistReview } from '@/lib/watchlist-review';
import type { ManualPlan } from '@/lib/manual-plan';
import type { ResearchFactRecord } from '@/lib/research-facts';
const mocks = vi.hoisted(() => ({ findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn() }));
vi.mock('@/database/models/research-change.model', () => ({ ResearchEventHistoryRecord: mocks }));
import {
    applyResearchChangeState, eventResearchChanges, journalResearchChanges, manualPlanResearchChanges, manualFactResearchChanges, observeAutomaticEvents, researchChangeCategory,
    validateResearchChangeState, type ResearchJournalRecord,
} from '@/lib/market/research-changes';

const baseTime = new Date('2026-11-08T01:00:00.000Z');
const later = (seconds: number) => new Date(baseTime.getTime() + seconds * 1000);
const event: MarketEvent = { id: 'em:600519.SH:2026-09-30:earnings', versionIdentity: 'em:600519.SH:2026-09-30:earnings',
    symbol: '600519.SH', title: '三季报预约披露', date: '2026-11-10', kind: 'earnings', certainty: 'estimated', source: '东方财富', sourceUrl: 'https://data.eastmoney.com/' };
let histories: Map<string, ResearchEventHistory>;
beforeEach(() => {
    vi.clearAllMocks(); histories = new Map();
    mocks.findOne.mockImplementation((filter: { userId: string; identity: string }) => ({ lean: async () => structuredClone(histories.get(`${filter.userId}:${filter.identity}`) ?? null) }));
    mocks.create.mockImplementation(async (record: ResearchEventHistory) => {
        const key = `${record.userId}:${record.identity}`;
        if (histories.has(key)) throw { code: 11000 };
        histories.set(key, structuredClone(record)); return record;
    });
    mocks.updateOne.mockImplementation(async (filter, update) => {
        const key = `${filter.userId}:${filter.identity}`; const saved = histories.get(key);
        if (!saved || saved.revision !== filter.revision || (filter.observedAt && saved.observedAt.getTime() !== filter.observedAt.getTime())) return { matchedCount: 0 };
        if (update.$max) {
            if (update.$max.observedAt > saved.observedAt) histories.set(key, { ...saved, observedAt: update.$max.observedAt });
            return { matchedCount: 1 };
        }
        histories.set(key, { ...saved, observedAt: update.$set.observedAt, revision: saved.revision + 1,
            versions: [...saved.versions, ...update.$push.versions.$each].slice(update.$push.versions.$slice) });
        return { matchedCount: 1 };
    });
});

describe('actual source event version journal', () => {
    it('establishes baseline then records before/after, source and discovery time only on changed dates', async () => {
        await observeAutomaticEvents('user-a', [event], baseTime);
        expect(eventResearchChanges([...histories.values()])).toEqual([]);
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }], later(1));
        const [change] = eventResearchChanges([...histories.values()]);
        expect(change).toMatchObject({ kind: 'event-date', before: { date: '2026-11-10' }, after: { date: '2026-11-12' },
            source: '东方财富', sourceUrl: event.sourceUrl, discoveredAt: later(1).toISOString() });
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }], later(2));
        expect([...histories.values()][0].versions).toHaveLength(2);
        expect([...histories.values()][0].revision).toBe(2);
        expect(mocks.updateOne.mock.calls[1][1]).toEqual({ $max: { observedAt: later(2) } });
        expect(histories.values().next().value?.observedAt).toEqual(later(2));
    });
    it('preserves versions for empty results, window/membership exit and non-identifiable TW rows', async () => {
        await observeAutomaticEvents('user-a', [event], baseTime);
        await observeAutomaticEvents('user-a', [], later(1));
        await observeAutomaticEvents('user-a', [{ ...event, versionIdentity: undefined }], later(2));
        expect(mocks.updateOne).not.toHaveBeenCalled();
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-20' }], later(3));
        expect(eventResearchChanges([...histories.values()])[0].after).toEqual({ date: '2026-11-20' });
    });
    it('deduplicates same-date rows and skips ambiguous conflicting source duplicates deterministically', async () => {
        await observeAutomaticEvents('user-a', [event, event], baseTime);
        expect(mocks.create).toHaveBeenCalledTimes(1);
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }, { ...event, date: '2026-11-14' }], later(1));
        expect(mocks.updateOne).not.toHaveBeenCalled();
    });
    it('scopes event versions by user and does not accept late older responses as new changes', async () => {
        await observeAutomaticEvents('user-a', [event], baseTime);
        await observeAutomaticEvents('user-b', [{ ...event, date: '2026-11-12' }], baseTime);
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-14' }], later(3));
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }], later(1));
        expect(histories.size).toBe(2);
        expect(eventResearchChanges([...histories.values()])).toHaveLength(1);
        expect(mocks.updateOne.mock.calls[0][0]).toMatchObject({ userId: 'user-a', revision: 1 });
    });
    it('recovers duplicate insert and same-version CAS races without duplicate revisions', async () => {
        await Promise.all([observeAutomaticEvents('user-a', [event], baseTime), observeAutomaticEvents('user-a', [event], baseTime)]);
        const moved = { ...event, date: '2026-11-12' };
        await Promise.all([observeAutomaticEvents('user-a', [moved], later(1)), observeAutomaticEvents('user-a', [moved], later(1))]);
        expect(histories.size).toBe(1);
        expect([...histories.values()][0].versions).toHaveLength(2);
        expect(eventResearchChanges([...histories.values()])).toHaveLength(1);
    });
    it('a later unchanged real source observation prevents delayed earlier differing responses from becoming facts', async () => {
        await observeAutomaticEvents('user-a', [event], baseTime);
        await observeAutomaticEvents('user-a', [event], later(3));
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }], later(2));
        expect(eventResearchChanges([...histories.values()])).toEqual([]);
        expect([...histories.values()][0].versions).toHaveLength(1);
    });
    it('CAS rejects a changed version racing a newer unchanged source watermark', async () => {
        await observeAutomaticEvents('user-a', [event], baseTime);
        const update = mocks.updateOne.getMockImplementation()!;
        mocks.updateOne.mockImplementationOnce(async (filter, mutation) => {
            await observeAutomaticEvents('user-a', [event], later(3));
            return update(filter, mutation);
        });
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }], later(2));
        expect([...histories.values()][0].versions).toHaveLength(1);
        expect(eventResearchChanges([...histories.values()])).toEqual([]);
    });
    it('a return to an earlier date is a new concrete version, independent of an old ignored fact', async () => {
        await observeAutomaticEvents('user-a', [event], baseTime);
        await observeAutomaticEvents('user-a', [{ ...event, date: '2026-11-12' }], later(1));
        await observeAutomaticEvents('user-a', [event], later(2));
        const changes = eventResearchChanges([...histories.values()]);
        expect(changes[0].id).not.toBe(changes[1].id);
        const ignored: ResearchChangeState = { userId: 'user-a', changeId: changes[0].id, status: 'ignored', revision: 1, updatedAt: later(2) };
        expect(applyResearchChangeState(changes[0], ignored, later(3)).status).toBe('ignored');
        expect(applyResearchChangeState(changes[1], undefined, later(3)).status).toBe('pending');
    });
});

const plan: ManualPlan = { id: 'independent-plan', symbol: 'AAPL', waitingCondition: '等待财报', invalidation: '利润下滑', nextAction: '核对利润',
    checkDate: '2026-11-08', manualState: 'waiting', scheduleRevision: 1, version: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
describe('independent manual plan due versions', () => {
    it('uses each market local date, including US before midnight and Asian markets after midnight', () => {
        expect(manualPlanResearchChanges([plan], baseTime)).toEqual([]);
        for (const symbol of ['600519.SH', '00700.HK', '2330.TW', '6488.TWO']) {
            expect(manualPlanResearchChanges([{ ...plan, symbol }], baseTime)).toHaveLength(1);
        }
        expect(manualPlanResearchChanges([plan], new Date('2026-11-08T05:00:00.000Z'))).toHaveLength(1);
    });
    it('keeps identity and real recorded time across refresh, text edits, and unrelated plan revisions', () => {
        const original = { ...plan, checkDate: '2026-11-07' };
        const [first] = manualPlanResearchChanges([original], baseTime);
        const [edited] = manualPlanResearchChanges([{ ...original, version: 10, nextAction: '追加文字', updatedAt: later(100).toISOString() }], later(200));
        expect(edited.id).toBe(first.id); expect(edited.discoveredAt).toBe(plan.createdAt);
        expect(edited.after?.nextAction).toBe('追加文字');
        expect(researchChangeCategory(first)).toBe('plan-due');
        const state: ResearchChangeState = { userId: 'user-a', changeId: first.id, status: 'processed', revision: 1, updatedAt: baseTime };
        expect(applyResearchChangeState(edited, state, later(200)).status).toBe('processed');
    });
    it('rescheduling back to the same date is a distinct version and completed/cancelled/future plans stay out', () => {
        const original = { ...plan, checkDate: '2026-11-07' };
        const [first] = manualPlanResearchChanges([original], baseTime);
        const [rescheduled] = manualPlanResearchChanges([{ ...original, scheduleRevision: 3 }], baseTime);
        expect(first.id).not.toBe(rescheduled.id);
        expect(manualPlanResearchChanges([{ ...original, manualState: 'completed' }, { ...original, manualState: 'cancelled' }, { ...plan, checkDate: '2026-11-09' }], baseTime)).toEqual([]);
        expect(validateResearchChangeState({ id: first.id, status: 'processed', expectedStateVersion: 0 }, baseTime).id).toBe(first.id);
    });
});
describe('manual fact concrete versions', () => {
    it('retains source text, real registration time, version and manual provenance without claiming verification', () => {
        const fact: ResearchFactRecord = { id: 'fact-a', rootId: 'fact-a', version: 1, symbol: 'AAPL', market: 'us', exchangeId: 'US',
            title: '财报事实', factText: '原文', factType: 'earnings', reportingPeriod: '2026Q3', sourceUrl: 'https://example.com/report',
            sourcePublishedAt: null, assessment: 'undetermined', assessmentNote: '', observationSnapshot: null,
            correctionOf: null, correctionReason: null, registrationMethod: 'manual', createdAt: baseTime.toISOString() };
        const [first] = manualFactResearchChanges([fact]);
        const [correction] = manualFactResearchChanges([{ ...fact, id: 'fact-b', version: 2, correctionOf: fact.id }]);
        expect(first).toMatchObject({ factId: fact.id, source: '人工登记事实（未经自动核验）', sourceUrl: fact.sourceUrl, discoveredAt: fact.createdAt,
            after: { factText: '原文', reportingPeriod: '2026Q3', sourcePublishedAt: null, version: 1 } });
        expect(correction.id).not.toBe(first.id); expect(correction.after?.correctionOf).toBe(fact.id);
        expect(manualFactResearchChanges([fact])[0].id).toBe(first.id);
        expect(researchChangeCategory(first)).toBe('external-fact');
        expect(validateResearchChangeState({ id: correction.id, status: 'ignored', expectedStateVersion: 0 }, baseTime).id).toBe(correction.id);
    });
});

const baseline: ObservationRevision = { kind: 'observation', id: '000_baseline', recordedAt: baseTime.toISOString(), modifiedAt: null,
    source: 'legacy-capture', observation: { reviewStatus: 'watching', note: '原观点', nextReviewDate: '2026-11-08' } };
const edit: ObservationRevision = { ...baseline, id: '001_edit', source: 'edit', modifiedAt: later(1).toISOString(), recordedAt: later(1).toISOString(),
    observation: { ...baseline.observation, note: '修改观点' } };
const record: ResearchJournalRecord = { _id: 'owner', symbol: '600519.SH', nextReviewDate: '2026-11-08', journal: [baseline, edit] };
describe('journal-derived observation and concrete due-plan facts', () => {
    it('derives the saved edit and before/after without creating a baseline change or read timestamp', () => {
        const first = journalResearchChanges([record], baseTime);
        const laterRead = journalResearchChanges([record], later(10));
        expect(first).toEqual(laterRead);
        expect(first.find((entry) => entry.kind === 'observation')).toMatchObject({ before: { note: '原观点' }, after: { note: '修改观点' }, discoveredAt: edit.modifiedAt });
        expect(journalResearchChanges([{ ...record, journal: [baseline], nextReviewDate: null }], baseTime)).toEqual([]);
    });
    it('deduplicates the same journal revision, and new edits cannot inherit ignored state', () => {
        const first = journalResearchChanges([record, record], baseTime);
        expect(first.filter((entry) => entry.kind === 'observation')).toHaveLength(1);
        const next = { ...edit, id: '002_edit', recordedAt: later(2).toISOString(), observation: { ...edit.observation, note: '新证据' } };
        const edits = journalResearchChanges([{ ...record, journal: [baseline, edit, next] }], baseTime).filter((entry) => entry.kind === 'observation');
        expect(edits).toHaveLength(2); expect(edits[0].id).not.toBe(edits[1].id);
    });
    it('uses actual due date and persisted plan version, not the day of a read', () => {
        const due = journalResearchChanges([record], baseTime).find((entry) => entry.kind === 'review-due')!;
        const nextDay = journalResearchChanges([record], new Date('2026-11-09T01:00:00Z')).find((entry) => entry.kind === 'review-due')!;
        expect(due.id).toBe(nextDay.id);
        const changed = journalResearchChanges([{ ...record, nextReviewDate: '2026-11-07' }], baseTime).find((entry) => entry.kind === 'review-due')!;
        expect(changed.id).not.toBe(due.id);
        expect(journalResearchChanges([{ ...record, nextReviewDate: '2026-11-09' }], baseTime).some((entry) => entry.kind === 'review-due')).toBe(false);
    });
    it.each([undefined, '2026-11-08T01:00:01.000Z'])('preserves due identity and handling after 102 review-only appends with observation token %s', (observationUpdatedAt) => {
        const original = { ...record, observationUpdatedAt };
        const before = journalResearchChanges([original], baseTime).find((entry) => entry.kind === 'review-due')!;
        const reviews: WatchlistReview[] = Array.from({ length: 102 }, (_, index) => ({
            kind: 'review', id: `review-${index}`, createdAt: later(index + 2).toISOString(), tradingDate: '2026-11-08',
            hypothesis: '观点', changes: '无新增计划', conclusion: '继续核查', verificationType: 'judgment',
            evidenceURLs: [], clientRequestId: `request-${index}`,
        }));
        const bounded = { ...original, journal: [...original.journal!, ...reviews].slice(-101), journalTruncated: true };
        const after = journalResearchChanges([bounded], later(104)).find((entry) => entry.kind === 'review-due')!;
        expect(after).toEqual(before);
        for (const status of ['processed', 'ignored'] as const) {
            const state: ResearchChangeState = { userId: 'user-a', changeId: before.id, status, revision: 1, updatedAt: baseTime };
            const savedStates = new Map([[before.id, state]]);
            expect(applyResearchChangeState(after, savedStates.get(after.id), later(104)).status).toBe(status);
        }
        const changedVersion = journalResearchChanges([{ ...bounded, observationUpdatedAt: later(105) }], later(106)).find((entry) => entry.kind === 'review-due')!;
        expect(changedVersion.id).not.toBe(before.id);
    });
    it('snoozes only a concrete version, expires without mutating persisted state and validates CAS input', () => {
        const [entry] = journalResearchChanges([record], baseTime);
        const state: ResearchChangeState = { userId: 'user-a', changeId: entry.id, status: 'snoozed', snoozedUntil: later(5), revision: 2, updatedAt: baseTime };
        expect(applyResearchChangeState(entry, state, baseTime).status).toBe('snoozed');
        expect(applyResearchChangeState(entry, state, later(6))).toMatchObject({ status: 'pending', stateVersion: 2 });
        expect(state.status).toBe('snoozed');
        expect(() => validateResearchChangeState({ id: entry.id, status: 'snoozed', snoozedUntil: baseTime.toISOString(), expectedStateVersion: 0 }, baseTime)).toThrow();
        expect(() => validateResearchChangeState({ id: entry.id, status: 'ignored', expectedStateVersion: -1 }, baseTime)).toThrow();
    });
});
