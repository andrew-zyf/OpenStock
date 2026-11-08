import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampledAlert } from '@/lib/alerts/checker';
import type { AlertDelivery, AlertObservation, AlertTriggerEvent } from '@/lib/alerts/evaluation';

type StoredAlert = SampledAlert & { active: boolean; triggered: boolean; expiresAt: Date; triggerEvent?: AlertTriggerEvent; delivery?: AlertDelivery };
const state = vi.hoisted(() => ({ alerts: [] as StoredAlert[], enabled: true }));
const sendEmail = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());
const userLookup = vi.hoisted(() => vi.fn());
const getObservations = vi.hoisted(() => vi.fn());

// A small atomic document store exercises the real CAS filters. No Mongo connection is made.
function valueAt(doc: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, doc);
}
function matches(doc: StoredAlert, filter: Record<string, unknown>) {
    return Object.entries(filter).every(([key, wanted]) => {
        const value = valueAt(doc, key);
        if (wanted && typeof wanted === 'object') {
            if ('$exists' in wanted) return Boolean(wanted.$exists) === (value !== undefined);
            if ('$gt' in wanted) return value instanceof Date && value > (wanted as { $gt: Date }).$gt;
        }
        return value === wanted;
    });
}
function applySet(doc: StoredAlert, update: { $set: Record<string, unknown> }) {
    for (const [path, value] of Object.entries(update.$set)) {
        const parts = path.split('.');
        let destination = doc as unknown as Record<string, unknown>;
        for (const part of parts.slice(0, -1)) destination = destination[part] as Record<string, unknown>;
        destination[parts[parts.length - 1]] = structuredClone(value);
    }
}
const atomicUpdate = vi.hoisted(() => vi.fn());
const updateOne = vi.hoisted(() => vi.fn());
const find = vi.hoisted(() => vi.fn());
vi.mock('@/database/models/alert.model', () => ({ Alert: { findOneAndUpdate: atomicUpdate, updateOne, find } }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: connect }));
vi.mock('@/lib/market-data', () => ({ get alertsEnabled() { return state.enabled; } }));
vi.mock('@/lib/nodemailer', () => ({ sendStockAlertEmail: sendEmail }));
vi.mock('@/lib/alerts/quotes', async importOriginal => ({
    ...await importOriginal<typeof import('@/lib/alerts/quotes')>(),
    getAlertObservations: getObservations,
    validateAlertQuote: (_symbol: string, quote: AlertObservation) => quote,
}));

import { deliverPendingAlert, recordAlertSample, runAlertCheck } from '@/lib/alerts/checker';
const now = new Date('2026-11-09T02:00:00.000Z');
const observation = (price: number, asOf = '2026-11-09T01:59:50.000Z'): AlertObservation => ({ price, asOf, source: 'tencent' });
function fixture(extra: Partial<StoredAlert> = {}): StoredAlert {
    return {
        _id: 'alert-1', userId: 'user-123', symbol: '9988.HK', mode: 'crossing', targetPrice: 100, condition: 'ABOVE',
        active: true, triggered: false, expiresAt: new Date('2026-11-10'),
        lastObservation: observation(99, '2026-11-09T01:55:00.000Z'), ...extra,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    state.enabled = true;
    state.alerts = [fixture()];
    vi.stubEnv('NODEMAILER_EMAIL', 'sender@example.com');
    vi.stubEnv('NODEMAILER_PASSWORD', 'mock-password');
    userLookup.mockResolvedValue({ email: 'owner@example.com' });
    connect.mockResolvedValue({ connection: { db: { collection: () => ({ findOne: userLookup }) } }, isValidObjectId: () => false });
    sendEmail.mockResolvedValue({ status: 'sent', messageId: 'mock-message' });
    atomicUpdate.mockImplementation(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        const found = state.alerts.find(alert => matches(alert, filter));
        if (!found) return null;
        applySet(found, update);
        return structuredClone(found);
    });
    updateOne.mockImplementation(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        const found = state.alerts.find(alert => matches(alert, filter));
        if (found) applySet(found, update);
        return { modifiedCount: found ? 1 : 0 };
    });
    find.mockImplementation((filter: Record<string, unknown>) => {
        const query = { select: () => query, lean: async () => structuredClone(state.alerts.filter(alert => matches(alert, filter))) };
        return query;
    });
    getObservations.mockResolvedValue({ '9988.HK': observation(101) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('atomic observations and one persisted trigger', () => {
    it('only one overlapping job claims a crossing event and retains provenance', async () => {
        const snapshot = structuredClone(state.alerts[0]);
        const results = await Promise.all([recordAlertSample(snapshot, observation(101), now), recordAlertSample(snapshot, observation(101), now)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(state.alerts[0]).toMatchObject({ active: false, triggered: true, delivery: { status: 'pending' }, triggerEvent: {
            id: 'alert-1:trigger', price: 101, direction: 'ABOVE', asOf: observation(101).asOf, source: 'tencent', observedAt: now.toISOString(),
        } });
    });
    it('rejects stale snapshots and out-of-order updates without overwriting a newer observation', async () => {
        const old = structuredClone(state.alerts[0]);
        await recordAlertSample(old, observation(98), now);
        expect(await recordAlertSample(old, observation(101, '2026-11-09T01:59:40.000Z'), now)).toBe(false);
        expect(state.alerts[0].lastObservation?.price).toBe(98);
        expect(await recordAlertSample(state.alerts[0], observation(101, '2026-11-09T01:59:30.000Z'), now)).toBe(false);
        expect(state.alerts[0].triggered).toBe(false);
    });
    it('seeds the first sample without firing, then waits for a real return and crossing', async () => {
        state.alerts = [fixture({ lastObservation: undefined })];
        expect(await recordAlertSample(structuredClone(state.alerts[0]), observation(101), now)).toBe(false);
        expect(state.alerts[0].triggered).toBe(false);
        await recordAlertSample(structuredClone(state.alerts[0]), observation(99, '2026-11-09T01:59:55.000Z'), now);
        expect(await recordAlertSample(structuredClone(state.alerts[0]), observation(100, now.toISOString()), now)).toBe(true);
    });
    it('does not claim a disabled, expired or previously triggered alert', async () => {
        const snapshot = structuredClone(state.alerts[0]);
        for (const extra of [{ active: false }, { expiresAt: now }, { triggered: true }]) {
            state.alerts = [fixture(extra)];
            expect(await recordAlertSample(snapshot, observation(101), now)).toBe(false);
        }
    });
    it('keeps legacy threshold semantics without an observation seed', async () => {
        state.alerts = [fixture({ mode: undefined, lastObservation: undefined })];
        expect(await recordAlertSample(state.alerts[0], observation(101), now)).toBe(true);
    });
});

describe('delivery is terminal and inspectable', () => {
    beforeEach(async () => { await recordAlertSample(structuredClone(state.alerts[0]), observation(101), now); });
    it('overlapping deliveries and retries submit only once to the owner using native currency and source time', async () => {
        await Promise.all([deliverPendingAlert('alert-1', now), deliverPendingAlert('alert-1', now)]);
        await deliverPendingAlert('alert-1', now);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(userLookup).toHaveBeenCalledWith({ id: 'user-123' });
        expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@example.com', currency: 'HKD', asOf: observation(101).asOf, source: 'tencent' }));
        expect(state.alerts[0].delivery).toMatchObject({ status: 'sent', messageId: 'mock-message' });
    });
    it('records failed SMTP without erasing the event or rearming on retries', async () => {
        sendEmail.mockRejectedValueOnce(new Error('mock SMTP rejection'));
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await deliverPendingAlert('alert-1', now);
        await deliverPendingAlert('alert-1', now);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(state.alerts[0]).toMatchObject({ active: false, triggered: true, triggerEvent: { id: 'alert-1:trigger' }, delivery: { status: 'failed', reason: 'email-send-failed' } });
        log.mockRestore();
    });
    it('skips unconfigured email without calling the sender or rearming', async () => {
        vi.stubEnv('NODEMAILER_PASSWORD', '');
        await deliverPendingAlert('alert-1', now);
        expect(sendEmail).not.toHaveBeenCalled();
        expect(state.alerts[0]).toMatchObject({ active: false, triggered: true, delivery: { status: 'skipped', reason: 'email-not-configured' } });
    });
    it('records missing owner email as skipped', async () => {
        userLookup.mockResolvedValueOnce(null);
        await deliverPendingAlert('alert-1', now);
        expect(sendEmail).not.toHaveBeenCalled();
        expect(state.alerts[0].delivery).toMatchObject({ status: 'skipped', reason: 'owner-email-missing' });
    });
    it('keeps uncertain post-SMTP persistence failures pending and never automatically resends', async () => {
        updateOne.mockRejectedValueOnce(new Error('mock DB write failure'));
        await expect(deliverPendingAlert('alert-1', now)).rejects.toThrow('mock DB write failure');
        await deliverPendingAlert('alert-1', now);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(state.alerts[0].delivery).toEqual({ status: 'pending', attemptedAt: now.toISOString() });
    });
});

describe('worker orchestration', () => {
    it('does nothing in cached mode', async () => {
        state.enabled = false;
        expect(await runAlertCheck()).toMatchObject({ status: 'disabled', processed: 0, triggered: 0 });
        expect(connect).not.toHaveBeenCalled();
    });
    it('does not observe missing quotes, then persists and delivers a later crossing once', async () => {
        getObservations.mockResolvedValueOnce({ '9988.HK': null });
        expect(await runAlertCheck()).toMatchObject({ triggered: 0 });
        expect(state.alerts[0].lastObservation?.price).toBe(99);
        expect(await runAlertCheck()).toMatchObject({ triggered: 1 });
        expect(await runAlertCheck()).toMatchObject({ triggered: 0 });
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });
    it('requests 24/7 legacy crypto observations explicitly and still dedupes threshold delivery', async () => {
        const symbol = 'BINANCE:BTCUSDT';
        state.alerts = [fixture({ symbol, mode: undefined, lastObservation: undefined })];
        getObservations.mockResolvedValue({ [symbol]: { ...observation(101), source: 'finnhub' } });
        expect(await runAlertCheck()).toMatchObject({ triggered: 1 });
        expect(getObservations).toHaveBeenCalledWith([symbol], undefined, [symbol]);
        await runAlertCheck();
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(state.alerts[0]).toMatchObject({ triggered: true, active: false, delivery: { status: 'sent' } });
    });
    it('resumes a committed event when its previous job stopped before claiming email', async () => {
        await recordAlertSample(structuredClone(state.alerts[0]), observation(101), now);
        await runAlertCheck();
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(state.alerts[0].delivery?.status).toBe('sent');
    });
});
