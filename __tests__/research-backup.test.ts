import { describe, expect, it } from 'vitest';
import { createResearchBackup, parseResearchBackup, planResearchImport, researchImportId, type ResearchBackup } from '@/lib/research-backup';

const time = '2026-11-08T01:00:00.000Z';
const snapshot = { price: 100, currency: 'HKD', source: 'test-source', asOf: time, fetchedAt: time, priceBasis: 'last-trade', adjustment: 'unadjusted' } as const;
function backup(): ResearchBackup {
    return {
        format: 'openstock-research', version: 1, exportedAt: time,
        research: [
            { id: '111111111111111111111111', symbol: '0700.HK', company: '腾讯', addedAt: time, note: '原始别名观点', initialSnapshot: { ...snapshot }, journalVersion: 2, journal: [
                { kind: 'review', id: 'original', createdAt: time, tradingDate: '2026-11-06', hypothesis: '观点', changes: '变化', conclusion: '结论', verificationType: 'fact', evidenceURLs: ['https://example.com/evidence'], clientRequestId: 'request-original', sourceQuote: { ...snapshot } },
                { kind: 'observation', id: 'revision', recordedAt: time, modifiedAt: null, source: 'legacy-capture', sourceSymbol: 'HKEX:700', reviewId: 'original', observation: { reviewStatus: 'watching', note: '旧观点' } },
            ] },
            { id: '222222222222222222222222', symbol: 'HKEX:700', company: '腾讯控股', addedAt: time, archivedAt: time, journal: [
                { kind: 'review', id: 'correction', correctionOf: 'original', createdAt: time, tradingDate: '2026-11-06', hypothesis: '更正观点', changes: '更正变化', conclusion: '更正结论', verificationType: 'judgment', evidenceURLs: [], clientRequestId: 'request-correction', nextReviewDate: null },
            ] },
        ],
        manualEvents: [{ id: '333333333333333333333333', symbol: '0700.HK', title: '核对公告', date: '2026-11-10', kind: 'other', clientRequestId: 'manual-request', createdAt: time, cancelledAt: time, sourceUrl: 'https://example.com/' }],
        alertReferences: { referenceOnly: true, alerts: [{ id: '444444444444444444444444', symbol: '0700.HK', targetPrice: 100, condition: 'ABOVE', mode: 'crossing', active: false, triggered: true, createdAt: time, expiresAt: time, triggerEvent: { id: 'trigger-1', price: 101, asOf: time, source: 'test-source', direction: 'ABOVE', observedAt: time }, delivery: { status: 'sent', attemptedAt: time, completedAt: time } }] },
    };
}
const parse = (value: unknown) => parseResearchBackup(JSON.stringify(value));
describe('versioned full research backup', () => {
    it('roundtrips every raw alias, journal reference, correction, snapshot and cancelled event', () => {
        const source = backup();
        const exported = createResearchBackup(source.research.map(({ id, ...row }) => ({ ...row, _id: id, userId: 'original-owner' })), source.manualEvents.map(({ id, ...row }) => ({ ...row, _id: id, userId: 'original-owner' })), source.alertReferences.alerts.map(({ id, ...row }) => ({ ...row, _id: id, userId: 'original-owner' })), new Date(time));
        expect(parse(exported)).toEqual(source);
        expect(JSON.stringify(exported)).not.toContain('original-owner');
        expect(exported.research[0].journal?.[1]).toMatchObject({ sourceSymbol: 'HKEX:700', reviewId: 'original' });
    });
    it('omits owner, unknown persistence fields and private delivery details on export', () => {
        const source = backup();
        const value = createResearchBackup([{ ...source.research[0], _id: source.research[0].id, userId: 'secret-owner', __v: 3, journal: [{ ...source.research[0].journal![1], userId: 'nested-owner' }] }], [], [{ ...source.alertReferences.alerts[0], _id: '444444444444444444444444', delivery: { status: 'failed', reason: 'smtp secret', messageId: 'private-id' } }]);
        const json = JSON.stringify(value);
        expect(json).not.toMatch(/secret-owner|nested-owner|smtp secret|private-id|__v/);
        expect(value.alertReferences.alerts[0].delivery).toEqual({ status: 'failed' });
    });
    it.each(['userId', 'ownerId', '__proto__', '$set', 'runAlerts'])('rejects injected ownership or execution field %s', (key) => {
        const value = backup();
        Object.defineProperty(value.research[0], key, { enumerable: true, value: 'attacker' });
        expect(() => parse(value)).toThrow('不支持的字段');
    });
    it('rejects nested ownership, unexpected snapshot fields and unsafe URL credentials', () => {
        const value = backup();
        Object.assign(value.research[0].journal![1], { userId: 'attacker' });
        expect(() => parse(value)).toThrow();
        const badSnapshot = backup(); Object.assign(badSnapshot.research[0].initialSnapshot!, { ownerId: 'attacker' });
        expect(() => parse(badSnapshot)).toThrow();
        for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://name:secret@example.com/', 'https://:secret@example.com/']) {
            const badURL = backup(); badURL.manualEvents[0].sourceUrl = url;
            expect(() => parse(badURL)).toThrow();
        }
    });
    it('rejects invalid calendar dates, ISO rollovers and unconfirmed identities', () => {
        const date = backup(); date.manualEvents[0].date = '2026-02-30'; expect(() => parse(date)).toThrow();
        const iso = backup(); iso.research[0].addedAt = '2026-02-30T01:00:00.000Z'; expect(() => parse(iso)).toThrow();
        const symbol = backup(); symbol.research[0].symbol = 'BINANCE:BTCUSDT'; expect(() => parse(symbol)).toThrow('身份');
        const source = backup(); Object.assign(source.research[0].journal![1], { sourceSymbol: 'AAPL' }); expect(() => parse(source)).toThrow('身份不匹配');
    });
    it('retains valid provider timestamps with offsets or omitted milliseconds', () => {
        const value = backup();
        value.research[0].initialSnapshot = { ...snapshot, asOf: '2026-11-08T09:00:00+08:00', fetchedAt: '2026-11-08T01:00:00Z' };
        expect(parse(value).research[0].initialSnapshot).toEqual(value.research[0].initialSnapshot);
        value.research[0].initialSnapshot.asOf = '2026-11-08T25:00:00+08:00';
        expect(() => parse(value)).toThrow('ISO');
    });
    it('treats active and archived aliases as one conflict and never revives cancelled manual events', () => {
        const source = parse(backup());
        const plan = planResearchImport(source, ['00700.HK'], [{ _id: source.manualEvents[0].id, clientRequestId: 'manual-request', cancelledAt: time }], 'current-owner');
        expect(plan.research).toEqual([{ symbol: '00700.HK', records: 2, status: 'skip-existing' }]);
        expect(plan.manualEvents[0].status).toBe('skip-existing');
        expect(plan.referenceAlerts).toBe(1);
        const renamed = backup(); renamed.manualEvents[0].clientRequestId = 'altered-request';
        expect(planResearchImport(renamed, [], [{ _id: source.manualEvents[0].id, clientRequestId: 'manual-request', cancelledAt: time }], 'current-owner').manualEvents[0].status).toBe('skip-existing');
    });
    it('generates stable owner-scoped import ids and recognizes imported manual ids', () => {
        const source = backup(); const id = source.manualEvents[0].id;
        expect(researchImportId('a', id)).toBe(researchImportId('a', id));
        expect(researchImportId('a', id)).not.toBe(researchImportId('b', id));
        expect(planResearchImport(source, [], [{ _id: researchImportId('a', id), clientRequestId: 'different-request' }], 'a').manualEvents[0].status).toBe('skip-existing');
    });
    it('rejects duplicate raw rows, journal ids and event requests instead of silently dropping data', () => {
        const record = backup(); record.research.push(record.research[0]); expect(() => parse(record)).toThrow('重复');
        const journal = backup(); journal.research[0].journal!.push(journal.research[0].journal![0]); expect(() => parse(journal)).toThrow('重复');
        const event = backup(); event.manualEvents.push({ ...event.manualEvents[0], id: '555555555555555555555555' }); expect(() => parse(event)).toThrow('重复');
        const collision = backup(); const original = collision.research[0].journal![0];
        if (original.kind !== 'review') throw new Error('fixture');
        collision.research[1].journal!.push({ ...original, createdAt: '2026-11-09T01:00:00.000Z' }); expect(() => parse(collision)).toThrow('冲突');
    });
    it('rejects dangling corrections and review links, cross-identity correction and cycles', () => {
        const dangling = backup(); Object.assign(dangling.research[1].journal![0], { correctionOf: 'missing' }); expect(() => parse(dangling)).toThrow('更正');
        const reviewLink = backup(); Object.assign(reviewLink.research[0].journal![1], { reviewId: 'missing' }); expect(() => parse(reviewLink)).toThrow('复核引用');
        const crossIdentity = backup(); crossIdentity.research[1].symbol = 'AAPL'; expect(() => parse(crossIdentity)).toThrow('更正');
        const cycle = backup(); Object.assign(cycle.research[0].journal![0], { correctionOf: 'correction' }); expect(() => parse(cycle)).toThrow('循环');
    });
    it('preserves multiple corrections to the same original supported by live journal writes', () => {
        const fork = backup(); const correction = fork.research[1].journal![0];
        fork.research[1].journal!.push({ ...correction, id: 'fork', clientRequestId: 'request-fork' } as typeof correction);
        expect(parse(fork).research[1].journal).toHaveLength(2);
    });
    it('validates version and explicit reference-only semantics', () => {
        expect(() => parse({ ...backup(), version: 2 })).toThrow('版本');
        const source = backup(); source.alertReferences.referenceOnly = false as true; expect(() => parse(source)).toThrow('仅供参考');
        const executable = backup(); Object.assign(executable.alertReferences.alerts[0], { send: true }); expect(() => parse(executable)).toThrow();
    });
    it('refuses oversized BSON histories without truncating any entries', () => {
        const source = backup(); source.research = [source.research[0]];
        const review = source.research[0].journal![0];
        source.research[0].journal = Array.from({ length: 2400 }, (_, index) => ({ ...review, id: `review-${index}`, clientRequestId: `request-${index}`, hypothesis: '观'.repeat(2000), changes: '变'.repeat(2000), conclusion: '结'.repeat(2000) })) as typeof source.research[0]['journal'];
        // Use ASCII so the upload stays below 32 MiB while BSON exceeds its 12 MiB safety ceiling.
        for (const entry of source.research[0].journal!) if (entry.kind === 'review') { entry.hypothesis = 'h'.repeat(2000); entry.changes = 'c'.repeat(2000); entry.conclusion = 'r'.repeat(2000); }
        expect(() => parse(source)).toThrow('BSON');
    });
    it('previews active-event capacity while still retaining cancellation tombstones', () => {
        const source = backup(); source.manualEvents.push({ ...source.manualEvents[0], id: '555555555555555555555555', cancelledAt: undefined, clientRequestId: 'new-active-event' });
        const existing = Array.from({ length: 100 }, (_, index) => ({ clientRequestId: `existing-${index}` }));
        expect(planResearchImport(source, [], existing, 'owner').manualEvents.map((event) => event.status)).toEqual(['import', 'skip-capacity']);
    });
});
