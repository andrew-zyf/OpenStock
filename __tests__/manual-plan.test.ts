import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { manualPlanFingerprint, validateCreateManualPlan, validateUpdateManualPlan } from '@/lib/manual-plan';
import { ManualPlanBook, ManualPlanRecord, ManualPlanSchedule } from '@/database/models/manual-plan.model';

const input = { symbol: 'HKEX:700', waitingCondition: '等待公告', invalidation: '假设不再成立', nextAction: '人工核对原始资料', checkDate: '2026-11-10', clientRequestId: 'request-123' };
describe('standalone manual plan validation', () => {
    it('canonicalizes market identity and keeps dates as calendar dates', () => {
        expect(validateCreateManualPlan(input)).toEqual({ ...input, symbol: '00700.HK' });
        expect(validateCreateManualPlan({ ...input, symbol: 'TPEX:6488', checkDate: '2028-02-29' })).toMatchObject({ symbol: '6488.TWO', checkDate: '2028-02-29' });
        expect(validateCreateManualPlan({ ...input, symbol: 'SSE:000001' }).symbol).toBe('000001.SS');
    });
    it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-11-10T00:00:00Z', '2026-1-01', '0000-01-01', '', null])('rejects invalid calendar date %s', (date) => {
        expect(() => validateCreateManualPlan({ ...input, checkDate: date })).toThrow('检查日期');
        expect(() => validateUpdateManualPlan({ checkDate: date })).toThrow('检查日期');
    });
    it.each(['userId', 'reviewStatus', 'quantity', 'fills', 'position', 'autoTrade', '$set', 'version'])('rejects unapproved field %s', (key) => {
        expect(() => validateCreateManualPlan({ ...input, [key]: 'injected' })).toThrow('字段');
        expect(() => validateUpdateManualPlan({ [key]: 'injected' })).toThrow('字段');
    });
    it('bounds identifiers, text, states and payload shape', () => {
        for (const value of [null, [], 'text']) expect(() => validateCreateManualPlan(value)).toThrow();
        for (const value of ['', ' ', 'x'.repeat(2001), '\u0000']) expect(() => validateCreateManualPlan({ ...input, nextAction: value })).toThrow();
        for (const symbol of ['<script>', 'HKEX:nope', 'x'.repeat(26), 'BINANCE:BTCUSDT']) expect(() => validateCreateManualPlan({ ...input, symbol })).toThrow();
        for (const clientRequestId of ['', 'short', 'x'.repeat(81), '$request-id']) expect(() => validateCreateManualPlan({ ...input, clientRequestId })).toThrow();
        for (const manualState of ['validated', 'filled', null, 1]) expect(() => validateUpdateManualPlan({ manualState })).toThrow('状态');
        expect(() => validateUpdateManualPlan({})).toThrow();
        expect(() => validateUpdateManualPlan({ symbol: 'AAPL' })).toThrow();
        expect(() => validateUpdateManualPlan({ nextAction: undefined })).toThrow();
        expect(validateUpdateManualPlan({ manualState: 'completed', nextAction: '  核查  ' })).toEqual({ manualState: 'completed', nextAction: '核查' });
    });
    it('compares immutable canonical initial content rather than the current plan state', () => {
        const original = validateCreateManualPlan(input);
        expect(manualPlanFingerprint(original)).toBe(manualPlanFingerprint(validateCreateManualPlan({ ...input, symbol: '0700.HK', nextAction: '  人工核对原始资料  ' })));
        expect(manualPlanFingerprint(original)).not.toBe(manualPlanFingerprint({ ...original, checkDate: '2026-11-11' }));
    });
    it('keeps independent fingerprint bytes compatible and distinguishes explicit version links', () => {
        const original = validateCreateManualPlan(input);
        expect(manualPlanFingerprint(original)).toBe(JSON.stringify(['00700.HK', input.waitingCondition, input.invalidation, input.nextAction, input.checkDate]));
        expect(manualPlanFingerprint({ ...original, observationVersionId: 'old-version' })).not.toBe(manualPlanFingerprint(original));
        for (const observationVersionId of ['', '$foreign', 'x'.repeat(101)]) expect(() => validateCreateManualPlan({ ...input, observationVersionId })).toThrow('观点版本');
        expect(validateUpdateManualPlan({ checkDate: '2026-11-11', scheduleReason: ' 等待年报 ' })).toEqual({ checkDate: '2026-11-11', scheduleReason: '等待年报' });
        expect(() => validateUpdateManualPlan({ scheduleReason: 'why' })).toThrow();
        expect(() => validateUpdateManualPlan({ stateReason: 'why' })).toThrow();
    });
    it('indexes independent plan identities and schedule history by owner without arrays', async () => {
        expect(ManualPlanRecord.schema.indexes()).toContainEqual([{ userId: 1, id: 1 }, expect.objectContaining({ unique: true })]);
        expect(ManualPlanRecord.schema.indexes()).toContainEqual([{ userId: 1, clientRequestId: 1 }, expect.objectContaining({ unique: true })]);
        expect(ManualPlanSchedule.schema.indexes()).toContainEqual([{ userId: 1, planId: 1, revision: -1 }, expect.objectContaining({ unique: true })]);
        const fields = { ...validateCreateManualPlan(input), userId: 'user-a', id: 'id', createFingerprint: 'initial', version: 1, scheduleRevision: 1, manualState: 'waiting', createdAt: new Date(), updatedAt: new Date() };
        await expect(new ManualPlanRecord(fields).validate()).resolves.toBeUndefined();
        await expect(new ManualPlanRecord({ ...fields, scheduleRevision: 1.5 }).validate()).rejects.toThrow('scheduleRevision');
        await expect(new ManualPlanSchedule({ userId: 'user-a', planId: 'id', revision: 2, fromDate: '2026-02-30', toDate: '2026-11-11', reason: 'why', changedAt: new Date() }).validate()).rejects.toThrow('fromDate');
        expect(ManualPlanRecord.schema.path('plans')).toBeUndefined();
    });
    it('saves a real Mongoose root record with its own _id before reaching the database adapter', async () => {
        // Exercise the actual Mongoose create/validate/save path; intercept only the DB adapter.
        // Schema.validate() alone misses {_id:false} accidentally inherited from embedded plans.
        const insert = vi.spyOn(ManualPlanRecord.collection, 'insertOne').mockResolvedValue({ acknowledged: true, insertedId: new Types.ObjectId() });
        try {
            const observationSnapshot = { recordedAt: '2026-11-07T01:00:00Z', note: '原始判断'.repeat(1000), invalidation: '历史合并反证'.repeat(1000) };
            const record = await ManualPlanRecord.create({ ...validateCreateManualPlan(input), userId: 'user-a', id: '11111111-1111-4111-8111-111111111111', createFingerprint: 'initial', version: 1, scheduleRevision: 1, manualState: 'waiting', observationVersionId: 'saved-version', observationSnapshot, createdAt: new Date(), updatedAt: new Date() });
            expect(record.observationSnapshot?.note).toBe(observationSnapshot.note);
            expect(record.observationSnapshot?.invalidation).toBe(observationSnapshot.invalidation);
            expect(record._id).toBeInstanceOf(Types.ObjectId);
            expect(insert).toHaveBeenCalledOnce();
            expect(insert.mock.calls[0][0]).toMatchObject({ _id: record._id, userId: 'user-a', scheduleRevision: 1 });
        } finally { insert.mockRestore(); }
    });
    it('retains a bounded read-compatible legacy book without using it for new history', async () => {
        expect(ManualPlanBook.schema.indexes()).toContainEqual([{ userId: 1 }, expect.objectContaining({ unique: true })]);
        const book = new ManualPlanBook({ userId: 'user-a', plans: Array.from({ length: 101 }, (_, index) => ({
            ...validateCreateManualPlan(input), id: String(index), createFingerprint: 'initial', version: 1, manualState: 'waiting', createdAt: new Date(), updatedAt: new Date(),
        })) });
        await expect(book.validate()).rejects.toThrow('plans');
    });
});
