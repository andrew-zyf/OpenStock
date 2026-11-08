import { beforeEach, describe, expect, it, vi } from 'vitest';

// Server actions are public endpoints: these tests pin that alerts are always scoped to the
// signed-in user, never to an id sent by the client. Adapted from #93.

const requireUserId = vi.fn();
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: () => requireUserId() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const observations = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/lib/alerts/quotes', () => ({ getAlertObservations: observations }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: vi.fn().mockResolvedValue({}) }));
// Alerts are an OpenStock Cloud feature; most tests run with it on
const flags = { alertsEnabled: true };
vi.mock('@/lib/market-data', () => ({ get alertsEnabled() { return flags.alertsEnabled; } }));

const findOneAndDelete = vi.fn();
const create = vi.fn();
const countDocuments = vi.fn().mockResolvedValue(0);
vi.mock('@/database/models/alert.model', () => ({
    Alert: {
        findOneAndDelete: (...args: unknown[]) => findOneAndDelete(...args),
        create: (...args: unknown[]) => create(...args),
        countDocuments: (...args: unknown[]) => countDocuments(...args),
    },
}));

import { createAlert, deleteAlert } from '@/lib/actions/alert.actions';

describe('alert actions are scoped to the session user', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireUserId.mockResolvedValue('user-123');
        findOneAndDelete.mockResolvedValue({ _id: 'alert-1', userId: 'user-123' });
        create.mockImplementation(async (doc: unknown) => doc);
    });

    it('caps active alerts per user, counting only that user’s', async () => {
        countDocuments.mockResolvedValueOnce(50);
        await expect(createAlert({ symbol: 'AAPL', targetPrice: 200, condition: 'ABOVE' })).rejects.toThrow('up to 50 active alerts');
        expect(countDocuments).toHaveBeenCalledWith({ userId: 'user-123', active: true, triggered: false, expiresAt: { $gt: expect.any(Date) } });
        expect(create).not.toHaveBeenCalled();
    });

    it('deletes the user’s own alert', async () => {
        await expect(deleteAlert('alert-1')).resolves.toEqual({ success: true });
        expect(findOneAndDelete).toHaveBeenCalledWith({ _id: 'alert-1', userId: 'user-123' });
    });

    it('rejects signed-out calls before touching the database', async () => {
        requireUserId.mockRejectedValue(new Error('Unauthorized'));
        await expect(deleteAlert('alert-1')).rejects.toThrow('Unauthorized');
        expect(findOneAndDelete).not.toHaveBeenCalled();
    });

    it('cannot delete another user’s alert: the query always carries the session user', async () => {
        findOneAndDelete.mockResolvedValue(null); // someone else's alert matches nothing
        await deleteAlert('alert-of-someone-else');
        expect(findOneAndDelete).toHaveBeenCalledWith({ _id: 'alert-of-someone-else', userId: 'user-123' });
    });

    it('creates alerts for the session user, ignoring any userId sent by the client', async () => {
        await createAlert({ symbol: 'AAPL', targetPrice: 200, condition: 'ABOVE', userId: 'attacker' } as never);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123', symbol: 'AAPL' }));
    });

    it('refuses new alerts where Cloud features are off', async () => {
        flags.alertsEnabled = false;
        try {
            await expect(createAlert({ symbol: 'AAPL', targetPrice: 200, condition: 'ABOVE' })).rejects.toThrow('OpenStock Cloud');
            expect(create).not.toHaveBeenCalled();
        } finally {
            flags.alertsEnabled = true;
        }
    });

    it.each(['RELIANCE.NS', 'VOD.L', 'BINANCE:BTCUSDT', '830799.BJ'])('refuses unsupported new alerts: %s', async symbol => {
        await expect(createAlert({ symbol, targetPrice: 1000, condition: 'ABOVE' })).rejects.toThrow('沪深、港股、台股和美股');
        expect(create).not.toHaveBeenCalled();
    });
});

describe('createAlert validates untrusted input', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireUserId.mockResolvedValue('user-123');
        create.mockImplementation(async (doc: unknown) => doc);
    });

    it('rejects symbols that could carry markup into alert emails', async () => {
        await expect(createAlert({ symbol: '<img src=x>', targetPrice: 1, condition: 'ABOVE' })).rejects.toThrow('Invalid symbol');
        expect(create).not.toHaveBeenCalled();
    });

    it.each([0, -1, NaN, Infinity, '100', null])('rejects non-positive or non-numeric target %s', async targetPrice => {
        await expect(createAlert({ symbol: 'AAPL', targetPrice: targetPrice as number, condition: 'ABOVE' })).rejects.toThrow('有限正数');
        expect(create).not.toHaveBeenCalled();
    });

    it.each([0, -1, 91, 1.5, NaN, '30', null])('rejects invalid expiry %s', async expiresInDays => {
        await expect(createAlert({ symbol: 'AAPL', targetPrice: 100, condition: 'ABOVE', expiresInDays: expiresInDays as number })).rejects.toThrow('1–90');
        expect(create).not.toHaveBeenCalled();
    });

    it.each([
        ['SSE:600519', '600519' + '.SS'], ['HKEX:9988', '09988.HK'], ['TWSE:2330', '2330.TW'], ['TPEX:6488', '6488.TWO'], ['NASDAQ:AAPL', 'AAPL'],
    ])('creates native aliases using canonical symbols: %s', async (symbol, canonical) => {
        await createAlert({ symbol, targetPrice: 100, condition: 'ABOVE', expiresInDays: 30 });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ symbol: canonical, mode: 'crossing', active: true }));
    });

    it('persists only a trusted fresh seed and ignores client observation or trigger event', async () => {
        const seed = { price: 99, asOf: '2026-11-09T01:59:00.000Z', source: 'tencent' };
        observations.mockResolvedValueOnce({ AAPL: seed });
        await createAlert({ symbol: 'AAPL', targetPrice: 100, condition: 'ABOVE', lastObservation: { price: 1 }, triggerEvent: { price: 1 } } as never);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ lastObservation: seed, triggered: false, mode: 'crossing' }));
        expect(create.mock.calls[0][0]).not.toHaveProperty('triggerEvent');
    });

    it('creates an unseeded alert when the upstream is unavailable', async () => {
        observations.mockRejectedValueOnce(new Error('mock upstream unavailable'));
        await createAlert({ symbol: 'AAPL', targetPrice: 100, condition: 'ABOVE' });
        expect(create.mock.calls[0][0]).not.toHaveProperty('lastObservation');
    });

    it('rejects unauthenticated creation before fetching quotes or touching the model', async () => {
        requireUserId.mockRejectedValueOnce(new Error('Unauthorized'));
        await expect(createAlert({ symbol: 'AAPL', targetPrice: 100, condition: 'ABOVE' })).rejects.toThrow('Unauthorized');
        expect(create).not.toHaveBeenCalled();
        expect(observations).not.toHaveBeenCalled();
    });

    it('rejects unknown conditions', async () => {
        await expect(createAlert({ symbol: 'AAPL', targetPrice: 1, condition: 'SIDEWAYS' as never })).rejects.toThrow('Invalid condition');
    });

    it('stores only validated fields, so callers cannot pre-trigger or extend an alert', async () => {
        await createAlert({ symbol: ' brk.b ', targetPrice: 400, condition: 'BELOW', triggered: true, expiresAt: new Date(2100, 0) } as never);
        expect(create).toHaveBeenCalledWith({ userId: 'user-123', symbol: 'BRK.B', targetPrice: 400, condition: 'BELOW', active: true, triggered: false, mode: 'crossing', expiresAt: expect.any(Date) });
        const stored = create.mock.calls[0][0];
        expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 90 * 86400_000);
    });
});
