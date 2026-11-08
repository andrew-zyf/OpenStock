import { describe, expect, it } from 'vitest';
import { manualPlanFingerprint, validateCreateManualPlan, validateUpdateManualPlan } from '@/lib/manual-plan';
import { ManualPlanBook } from '@/database/models/manual-plan.model';

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
    it('defines a unique owner book and rejects arrays beyond the retained record cap without database access', async () => {
        expect(ManualPlanBook.schema.indexes()).toContainEqual([{ userId: 1 }, expect.objectContaining({ unique: true })]);
        const book = new ManualPlanBook({ userId: 'user-a', plans: Array.from({ length: 101 }, (_, index) => ({
            ...validateCreateManualPlan(input), id: String(index), createFingerprint: 'initial', version: 1, manualState: 'waiting', createdAt: new Date(), updatedAt: new Date(),
        })) });
        await expect(book.validate()).rejects.toThrow('plans');
    });
});
