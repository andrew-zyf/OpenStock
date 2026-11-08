import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BSON } from 'mongodb';
import { observationState } from '@/lib/watchlist-review';
import { ResearchComparisonRecord } from '@/database/models/research-comparison.model';
import { canonicalPeerMember, compareDailyResearch, compareDailyVolume, type DailyResearchResult } from '@/lib/market/daily-research';
import type { ChartSeries } from '@/lib/realtime-market';
import { createComparisonDraftStore, DAILY_RESEARCH_ALGORITHM_VERSION, validateResearchComparisonPayload, validateSaveComparisonInput, type ResearchComparisonPayload } from '@/lib/research-comparisons';

function fixture(): ResearchComparisonPayload {
    const stock: ChartSeries = { symbol: '000001.SZ', market: 'cn', currency: 'CNY', source: 'tencent-kline', period: '3m', interval: 'day', adjustment: 'forward',
        provenance: { requestedAdjustment: 'forward', actualKey: 'qfqday', sourceInterval: 'day' }, volumeUnit: 'shares', fetchedAt: '2026-11-07T00:00:00Z', asOf: '2026-11-06T08:00:00Z',
        points: Array.from({ length: 21 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, time: '', close: 100 + i, volume: i === 20 ? 0 : 1000 })), latestPrice: 120, periodHigh: 120, periodLow: 100, change: 20, changePercent: 20 };
    const benchmark = { ...stock, symbol: '510300.SS' };
    const result: DailyResearchResult = { scope: 'watched', fetchedAt: '2026-11-08T00:00:00Z', benchmarkSymbol: benchmark.symbol, commonDates: stock.points.map(point => point.date),
        rows: [{ ...canonicalPeerMember(stock.symbol), comparison: compareDailyResearch(stock.symbol, stock, benchmark.symbol, benchmark), volume: compareDailyVolume(stock.symbol, stock) }],
        omittedMembers: [canonicalPeerMember('AAPL')] };
    return { caption: '量能尚不能支持原判断', algorithmVersion: DAILY_RESEARCH_ALGORITHM_VERSION, result, originalSeries: [{ symbol: stock.symbol, series: stock }, { symbol: benchmark.symbol, series: benchmark }] };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T00:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('server-issued comparison draft trust boundary', () => {
    it('retains the exact result and originals independently of caller/cache mutation', () => {
        const store = createComparisonDraftStore(); const payload = fixture();
        const issued = store.issue('owner', payload.result, payload.originalSeries);
        payload.result.rows[0].volume.volume = 99999; payload.originalSeries[0].series!.points[0].close = 1;
        const saved = store.read('owner', issued.id);
        expect(saved.result.rows[0].volume.volume).toBe(0); expect(saved.originalSeries[0].series!.points[0].close).toBe(100);
        saved.result.rows.length = 0; expect(store.read('owner', issued.id).result.rows).toHaveLength(1);
        expect(saved.originalSeries[0].series).toMatchObject({ source: 'tencent-kline', asOf: '2026-11-06T08:00:00Z', currency: 'CNY', provenance: { actualKey: 'qfqday' } });
    });
    it('rejects other owners and expired drafts with a safe restart/expiry explanation', () => {
        const store = createComparisonDraftStore(1000); const payload = fixture(); const issued = store.issue('owner', payload.result, payload.originalSeries);
        expect(() => store.read('other', issued.id)).toThrow('不属于当前账户');
        vi.advanceTimersByTime(1000); expect(() => store.read('owner', issued.id)).toThrow('服务已重启');
        expect(() => createComparisonDraftStore().read('owner', issued.id)).toThrow('不会被自动替换');
    });
    it('bounds per-owner drafts, total drafts and total retained bytes', () => {
        const payload = fixture(); const store = createComparisonDraftStore(60_000, 2, 1);
        const first = store.issue('a', payload.result, payload.originalSeries); store.issue('a', payload.result, payload.originalSeries);
        expect(() => store.read('a', first.id)).toThrow();
        const second = store.issue('b', payload.result, payload.originalSeries); store.issue('c', payload.result, payload.originalSeries);
        expect(store.read('b', second.id).result.rows).toHaveLength(1);
        expect(() => createComparisonDraftStore(1000, 2, 1, 10).issue('a', payload.result, payload.originalSeries)).toThrow('样本过大');
    });
});
describe('strict comparison backup payload boundary', () => {
    it('round-trips displayed outputs and complete original samples without zero/missing conflation', () => {
        const payload = fixture(); payload.result.rows[0].volume.reason = undefined;
        const validated = validateResearchComparisonPayload(payload);
        expect(validated.result.rows[0].volume.volume).toBe(0);
        expect(validated.originalSeries[0].series!.points).toHaveLength(21);
        expect(validated.result.omittedMembers[0].symbolId).toBe('US:AAPL');
        expect(Object.hasOwn(validated.result.rows[0].volume, 'reason')).toBe(false);
    });
    it.each(['root', 'result', 'row', 'comparison', 'volume', 'series', 'provenance', 'point'])('rejects injected owner/action fields at %s', target => {
        const payload = fixture();
        const objects: Record<string, object> = { root: payload, result: payload.result, row: payload.result.rows[0], comparison: payload.result.rows[0].comparison,
            volume: payload.result.rows[0].volume, series: payload.originalSeries[0].series!, provenance: payload.originalSeries[0].series!.provenance, point: payload.originalSeries[0].series!.points[0] };
        Object.assign(objects[target], { userId: 'forged' });
        expect(() => validateResearchComparisonPayload(payload)).toThrow('字段或格式');
    });
    it('rejects client numerical/source data and ownership fields on save commands', () => {
        const input = { draftId: 'issued-id', requestId: 'save-id', caption: '保存依据' };
        expect(validateSaveComparisonInput(input)).toEqual(input);
        for (const field of ['result', 'originalSeries', 'userId', 'savedAt']) expect(() => validateSaveComparisonInput({ ...input, [field]: {} })).toThrow();
        expect(() => validateSaveComparisonInput({ ...input, caption: ' ' })).toThrow();
        expect(() => validateSaveComparisonInput({ ...input, requestId: '$unsafe' })).toThrow();
    });
    it('requires original observation id, version and member identity to match the retained revision', () => {
        const payload = fixture();
        payload.observationReference = { symbolId: 'SZSE:000001.SZ', observationId: 'revision-1', version: '2026-11-07T00:00:00Z' };
        payload.originalObservation = { kind: 'observation', id: 'revision-1', recordedAt: '2026-11-07T00:00:00Z', modifiedAt: null, source: 'legacy-capture', observation: { reviewStatus: 'watching', note: '原文', group: '研'.repeat(80) } };
        expect(validateResearchComparisonPayload(payload).originalObservation?.observation.note).toBe('原文');
        payload.observationReference.version = '2026-11-08T00:00:00Z'; expect(() => validateResearchComparisonPayload(payload)).toThrow();
    });
    it('normalizes BSON-null optional observation state fields without inventing zero or dropping unknown fields', () => {
        const payload = fixture();
        const raw = BSON.deserialize(BSON.serialize({ kind: 'observation', id: 'bson-revision', recordedAt: '2026-11-07T00:00:00Z', modifiedAt: null,
            source: 'legacy-capture', observation: observationState({ reviewStatus: 'watching', note: '原文', proximityPercent: 0 }) }, { ignoreUndefined: false }));
        expect(raw.observation.targetPrice).toBeNull(); expect(raw.observation.reviewedAt).toBeNull();
        payload.observationReference = { symbolId: 'SZSE:000001.SZ', observationId: raw.id, version: raw.recordedAt };
        payload.originalObservation = raw as ResearchComparisonPayload['originalObservation'];
        const validated = validateResearchComparisonPayload(payload);
        expect(validated.originalObservation?.observation).toEqual({ reviewStatus: 'watching', note: '原文', proximityPercent: 0 });
        expect(raw.observation.targetPrice).toBeNull();
        raw.observation.ownerId = null;
        expect(() => validateResearchComparisonPayload(payload)).toThrow('字段或格式');
        delete raw.observation.ownerId; raw.observation.reviewStatus = null;
        expect(() => validateResearchComparisonPayload(payload)).toThrow('字段或格式');
    });
    it('retains merged historical observation text beyond current input limits without truncation', () => {
        const payload = fixture();
        payload.observationReference = { symbolId: 'SZSE:000001.SZ', observationId: 'legacy-merged', version: '2026-11-07T00:00:00Z' };
        payload.originalObservation = { kind: 'observation', id: 'legacy-merged', recordedAt: '2026-11-07T00:00:00Z', modifiedAt: null, source: 'legacy-capture',
            observation: { reviewStatus: 'watching', note: '旧别名原文'.repeat(1000), invalidation: '原始失效条件'.repeat(1000) } };
        expect(validateResearchComparisonPayload(payload).originalObservation).toEqual(payload.originalObservation);
        expect(() => validateSaveComparisonInput({ draftId: 'issued', requestId: 'request', caption: '新'.repeat(2001) })).toThrow();
        payload.originalObservation.observation.note = '原'.repeat(700_000);
        expect(() => validateResearchComparisonPayload(payload)).toThrow('原文未截断');
    });
    it('marks all stored source/result/context fields immutable and scopes idempotency indexes to owner', () => {
        for (const field of ['userId', 'draftId', 'requestId', 'caption', 'algorithmVersion', 'result', 'originalSeries', 'originalObservation', 'observationReference', 'createdAt', 'savedAt']) {
            expect(ResearchComparisonRecord.schema.path(field).options.immutable).toBe(true);
        }
        expect(ResearchComparisonRecord.schema.indexes()).toEqual(expect.arrayContaining([
            [expect.objectContaining({ userId: 1, requestId: 1 }), expect.objectContaining({ unique: true })],
            [expect.objectContaining({ userId: 1, draftId: 1 }), expect.objectContaining({ unique: true })],
        ]));
    });
});
