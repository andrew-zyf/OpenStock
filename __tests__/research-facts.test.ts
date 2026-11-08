import { describe, expect, it } from 'vitest';
import { ResearchFact } from '@/database/models/research-fact.model';
import {
    FACT_TYPES, factSourceUrl, factTimestamp, researchFactFingerprint, validateCreateResearchFact, validateResearchFactRecord,
    type CreateResearchFactInput, type ResearchFactRecord,
} from '@/lib/research-facts';

const id = '11111111-1111-4111-8111-111111111111';
const input: CreateResearchFactInput = { symbol: 'HKEX:700', factType: 'profit-warning', reportingPeriod: 'FY2026 中期', title: '原始公告', factText: '公司披露利润区间，须人工核对口径', sourceUrl: 'https://example.com/report', sourcePublishedAt: null, assessment: 'undetermined', assessmentNote: '', clientRequestId: 'request-1234' };
function record(): ResearchFactRecord {
    const value = validateCreateResearchFact(input);
    return { id, symbol: value.symbol, market: 'hk', exchangeId: 'HKEX', factType: value.factType, reportingPeriod: value.reportingPeriod,
        title: value.title, factText: value.factText, sourceUrl: value.sourceUrl, sourcePublishedAt: null,
        assessment: value.assessment, assessmentNote: '', createdAt: '2026-11-08T01:00:00.000Z', registrationMethod: 'manual', observationSnapshot: null,
        correctionOf: null, correctionReason: null, rootId: id, version: 1 };
}
describe('manual fact boundary validation', () => {
    it('normalizes aliases with market-specific types and preserves an explicitly unknown publication time', () => {
        expect(validateCreateResearchFact(input)).toMatchObject({ symbol: '00700.HK', sourcePublishedAt: null, factType: 'profit-warning' });
        for (const [symbol, market] of [['600519.SH', 'cn'], ['00700.HK', 'hk'], ['2330.TW', 'tw'], ['AAPL', 'us']] as const) {
            for (const factType of FACT_TYPES[market]) expect(validateCreateResearchFact({ ...input, symbol, factType }).factType).toBe(factType);
        }
        expect(() => validateCreateResearchFact({ ...input, symbol: 'AAPL' })).toThrow('市场');
        expect(() => validateCreateResearchFact({ ...input, symbol: '???' })).toThrow('代码');
        expect(() => validateCreateResearchFact({ ...input, sourcePublishedAt: undefined })).toThrow('时间');
    });
    it('accepts only absolute HTTP(S) links without credentials and rejects parser tricks', () => {
        expect(factSourceUrl('https://EXAMPLE.com:443/report')).toBe('https://example.com/report');
        expect(factSourceUrl('http://example.com/report')).toBe('http://example.com/report');
        for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '//example.com', '/relative', 'https://user:secret@example.com', 'https://:secret@example.com', 'https://user@example.com', 'https://exam\nple.com', 'https://example.com/hello world']) expect(() => factSourceUrl(url), url).toThrow();
    });
    it('requires real complete offset timestamps, never a browser-local or overflowed day', () => {
        expect(factTimestamp('2026-11-08T18:00:00+08:00')).toBe('2026-11-08T10:00:00.000Z');
        for (const value of ['2026-11-08', '2026-11-08T18:00:00', '2026-02-30T00:00:00Z', '2026-11-08T24:00:00Z', '2026-11-08T18:61:00Z', 'yesterday', 1]) expect(() => factTimestamp(value)).toThrow();
    });
    it('rejects owner/time/version/financial-action injection and malformed correction references', () => {
        for (const field of ['userId', 'createdAt', 'fetchedAt', 'version', 'reviewStatus', 'quantity']) expect(() => validateCreateResearchFact({ ...input, [field]: 'injected' })).toThrow('字段');
        expect(() => validateCreateResearchFact({ ...input, correctionOf: id })).toThrow('文本');
        expect(() => validateCreateResearchFact({ ...input, correctionOf: '$ne', correctionReason: '修正' })).toThrow('编号');
        expect(() => validateCreateResearchFact({ ...input, correctionReason: '无父事实' })).toThrow('原事实');
        expect(() => validateCreateResearchFact({ ...input, observationReference: { userId: 'other' } })).toThrow('字段');
    });
    it('dedup fingerprint canonicalizes alias, URL and timestamp but distinguishes all evidence and assessment changes', () => {
        const normalized = validateCreateResearchFact(input);
        expect(researchFactFingerprint(normalized)).toBe(researchFactFingerprint(validateCreateResearchFact({ ...input, symbol: '0700.HK', sourceUrl: 'https://EXAMPLE.com:443/report' })));
        for (const change of [{ factText: '新版原文' }, { assessment: 'supports' as const }, { sourcePublishedAt: '2026-11-08T01:00:00Z' }, { reportingPeriod: 'FY2025' }]) expect(researchFactFingerprint(validateCreateResearchFact({ ...input, ...change }))).not.toBe(researchFactFingerprint(normalized));
    });
    it('strictly validates backup snapshots and correction topology without accepting nested owner fields', () => {
        expect(validateResearchFactRecord(record())).toEqual(record());
        const snapshot = { recordId: '111111111111111111111111', sourceSymbol: 'HKEX:700', revisionId: 'original-revision', journalVersion: 4, observationUpdatedAt: null, archivedAt: '2026-11-07T00:00:00.000Z', observation: { note: '原盈利假设', reviewStatus: 'watching' } };
        expect(validateResearchFactRecord({ ...record(), observationSnapshot: snapshot }).observationSnapshot).toEqual(snapshot);
        expect(() => validateResearchFactRecord({ ...record(), observationSnapshot: { ...snapshot, userId: 'other' } })).toThrow('字段');
        expect(() => validateResearchFactRecord({ ...record(), observationSnapshot: { ...snapshot, observation: { ...snapshot.observation, owner: 'other' } } })).toThrow('字段');
        expect(() => validateResearchFactRecord({ ...record(), observationSnapshot: { ...snapshot, sourceSymbol: 'AAPL' } })).toThrow('标的');
        expect(() => validateResearchFactRecord({ ...record(), correctionOf: id, correctionReason: '更正', version: 2 })).toThrow('关系');
    });
    it('preserves immutable legacy merged observation text above current editing limits through pure and model validation', async () => {
        const note = `${'甲'.repeat(2000)}\n\n${'乙'.repeat(2000)}`;
        const invalidation = `${'原失效条件'.repeat(600)}\n\n历史合并原文`;
        const saved = { ...record(), observationSnapshot: { recordId: '111111111111111111111111', sourceSymbol: '00700.HK', revisionId: 'legacy-merged', journalVersion: 4, observationUpdatedAt: null, archivedAt: null, observation: { note, invalidation, reviewStatus: 'watching' as const } } };
        expect(validateResearchFactRecord(saved)).toEqual(saved);
        const document = new ResearchFact({ ...saved, createdAt: new Date(saved.createdAt), userId: 'owner', clientRequestId: input.clientRequestId, createFingerprint: 'original-request' });
        await expect(document.validate()).resolves.toBeUndefined();
        expect(document.toObject().observationSnapshot?.observation).toEqual(saved.observationSnapshot.observation);
        expect(() => validateCreateResearchFact({ ...input, factText: '新'.repeat(4001) })).toThrow('4000');
    });
    it('model validates public fields, immutable paths, owner indexes and correction-fork prevention without database writes', async () => {
        const fact = new ResearchFact({ ...record(), createdAt: new Date(record().createdAt), userId: 'owner', clientRequestId: input.clientRequestId, createFingerprint: 'original-request' });
        await expect(fact.validate()).resolves.toBeUndefined();
        expect(ResearchFact.schema.path('id').options.immutable).toBe(true);
        expect(ResearchFact.schema.path('observationSnapshot').options.immutable).toBe(true);
        expect(ResearchFact.schema.indexes()).toEqual(expect.arrayContaining([
            [expect.objectContaining({ userId: 1, id: 1 }), expect.objectContaining({ unique: true })],
            [expect.objectContaining({ userId: 1, clientRequestId: 1 }), expect.objectContaining({ unique: true })],
            [expect.objectContaining({ userId: 1, correctionOf: 1 }), expect.objectContaining({ unique: true, partialFilterExpression: { correctionOf: { $type: 'string' } } })],
        ]));
    });
});
