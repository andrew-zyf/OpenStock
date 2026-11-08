import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobRunStateRecord } from '@/database/models/job-run-state.model';

const db = vi.hoisted(() => ({ connect: vi.fn(), update: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: db.connect }));
vi.mock('@/database/models/job-run-state.model', () => ({ JobRunState: { updateOne: db.update } }));
import { ALERT_JOB_ID, summarizeAlertHealth, withAlertJobHeartbeat } from '@/lib/alerts/health';

const instant = '2026-11-08T10:00:00.000Z';
const record = (extra: Partial<JobRunStateRecord> = {}): JobRunStateRecord => ({
    _id: ALERT_JOB_ID, runId: 'run', lastStartedAt: new Date(instant), ...extra,
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    vi.clearAllMocks();
    db.connect.mockResolvedValue({});
    db.update.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('honest job completion evidence', () => {
    it('separates cached mode, read failure and a start without completion evidence', () => {
        expect(summarizeAlertHealth(null, false).status).toBe('cached-mode');
        expect(summarizeAlertHealth(null, true, new Date(), true).status).toBe('unknown');
        expect(summarizeAlertHealth(null, true).status).toBe('no-heartbeat');
        expect(summarizeAlertHealth(record(), true)).toMatchObject({ status: 'no-heartbeat', lastCompletedAt: null, lastStartedAt: instant });
    });
    it('uses completion age, with an explicit 15-minute boundary', () => {
        const state = record({ lastCompletedAt: new Date(instant), latestOutcome: 'completed' });
        expect(summarizeAlertHealth(state, true, new Date('2026-11-08T10:15:00Z')).status).toBe('recent');
        expect(summarizeAlertHealth(state, true, new Date('2026-11-08T10:15:00.001Z')).status).toBe('overdue');
        expect(summarizeAlertHealth({ ...state, lastStartedAt: new Date('2026-11-08T10:16:00Z') }, true, new Date('2026-11-08T10:16:00Z')).status).toBe('overdue');
    });
    it('retains failure until a completed attempt and treats future evidence as unknown', () => {
        const state = record({ lastCompletedAt: new Date('2026-11-08T09:59:00Z'), lastFailedAt: new Date(instant), latestOutcome: 'failed' });
        expect(summarizeAlertHealth(state, true).status).toBe('failed');
        expect(summarizeAlertHealth(state, true, new Date('2026-11-08T09:58:00Z')).status).toBe('unknown');
        expect(summarizeAlertHealth({ ...state, latestOutcome: 'completed' }, true).status).toBe('recent');
    });
    it('only writes completion after the task resolves and preserves the task result', async () => {
        const work = deferred<{ status: string }>();
        const entered = deferred<void>();
        const pending = withAlertJobHeartbeat(async () => { entered.resolve(); return work.promise; });
        await entered.promise;
        expect(db.update).toHaveBeenCalledTimes(1);
        vi.setSystemTime('2026-11-08T10:01:00Z');
        work.resolve({ status: 'checked' });
        await expect(pending).resolves.toEqual({ status: 'checked' });
        expect(db.update.mock.calls[1]).toEqual([
            { _id: ALERT_JOB_ID, runId: expect.any(String) },
            { $set: { latestOutcome: 'completed' }, $max: { lastCompletedAt: new Date('2026-11-08T10:01:00Z') } },
        ]);
    });
    it('records failure without writing completion or swallowing the original error', async () => {
        const failure = new Error('private task detail');
        await expect(withAlertJobHeartbeat(async () => { throw failure; })).rejects.toBe(failure);
        expect(db.update.mock.calls[1][1]).toEqual({ $set: { latestOutcome: 'failed' }, $max: { lastFailedAt: new Date(instant) } });
        expect(JSON.stringify(db.update.mock.calls)).not.toContain('private task detail');
    });
    it('does not turn heartbeat write failures into task failures', async () => {
        db.update.mockRejectedValue(new Error('secret connection detail'));
        const task = vi.fn().mockResolvedValue('original result');
        await expect(withAlertJobHeartbeat(task)).resolves.toBe('original result');
        expect(task).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledTimes(2);
        const failure = new Error('original failure');
        await expect(withAlertJobHeartbeat(async () => { throw failure; })).rejects.toBe(failure);
    });
});

// Small in-memory interpreter for the Mongo expressions used in the atomic start update.
// It lets race tests exercise the actual generated pipeline without a live database.
function evaluate(expression: unknown, document: Record<string, unknown>): unknown {
    if (typeof expression === 'string' && expression.startsWith('$')) return document[expression.slice(1)];
    if (!expression || expression instanceof Date || typeof expression !== 'object') return expression;
    if (Array.isArray(expression)) return expression.map(value => evaluate(value, document));
    const [operator, operands] = Object.entries(expression)[0];
    const values = (operands as unknown[]).map(value => evaluate(value, document));
    const scalar = (value: unknown) => value instanceof Date ? value.getTime() : value;
    switch (operator) {
        case '$ifNull': return values[0] ?? values[1];
        case '$eq': return scalar(values[0]) === scalar(values[1]);
        case '$lt': return (scalar(values[0]) as number) < (scalar(values[1]) as number);
        case '$and': return values.every(Boolean);
        case '$or': return values.some(Boolean);
        case '$cond': return values[0] ? values[1] : values[2];
        case '$max': return values.filter(value => value !== undefined && value !== null)
            .reduce((maximum, value) => (scalar(value) as number) > (scalar(maximum) as number) ? value : maximum);
        default: throw new Error(`Unsupported mock expression ${operator}`);
    }
}

describe('terminal recovery after a lost start heartbeat', () => {
    it.each([
        ['existing record', 'failed'], ['existing record', 'completed'],
        ['no record', 'failed'], ['no record', 'completed'],
    ] as const)('recovers %s with a real %s outcome after persistence returns', async (initial, outcome) => {
        const persisted: Record<string, unknown> = initial === 'existing record' ? record({
            lastStartedAt: new Date('2026-11-08T09:59:00Z'),
            lastCompletedAt: new Date('2026-11-08T09:59:00Z'), latestOutcome: 'completed',
        }) as unknown as Record<string, unknown> : {};
        let writes = 0;
        db.update.mockImplementation(async (filter, update) => {
            if (++writes === 1) throw new Error('temporary start write failure');
            if (Array.isArray(update)) {
                const prior = { ...persisted };
                for (const [field, expression] of Object.entries(update[0].$set)) {
                    const value = evaluate(expression, prior);
                    if (value !== undefined) persisted[field] = value;
                }
                return { matchedCount: initial === 'existing record' ? 1 : 0, upsertedCount: initial === 'no record' ? 1 : 0 };
            }
            if (filter.runId !== persisted.runId) return { matchedCount: 0, upsertedCount: 0 };
            throw new Error('unexpected terminal match before recovery');
        });
        const taskError = new Error('original task failure');
        const pending = withAlertJobHeartbeat(async () => {
            vi.setSystemTime('2026-11-08T10:00:02Z');
            if (outcome === 'failed') throw taskError;
            return 'original result';
        });
        if (outcome === 'failed') await expect(pending).rejects.toBe(taskError);
        else await expect(pending).resolves.toBe('original result');
        expect(writes).toBe(3);
        expect(persisted).toMatchObject({ lastStartedAt: new Date(instant), latestOutcome: outcome });
        const summary = summarizeAlertHealth(persisted as unknown as JobRunStateRecord, true);
        expect(summary.status).toBe(outcome === 'failed' ? 'failed' : 'recent');
        if (outcome === 'failed') {
            expect(summary.lastFailedAt).toBe('2026-11-08T10:00:02.000Z');
            expect(summary.lastCompletedAt).toBe(initial === 'existing record' ? '2026-11-08T09:59:00.000Z' : null);
        } else expect(summary.lastCompletedAt).toBe('2026-11-08T10:00:02.000Z');
        expect(JSON.stringify(persisted)).not.toContain('original task failure');
    });
    it.each(['completed', 'failed'] as const)('does not recover an old failure over a newer %s run', async newerOutcome => {
        let persisted: Record<string, unknown> = record({
            lastStartedAt: new Date('2026-11-08T09:59:00Z'),
            lastCompletedAt: new Date('2026-11-08T09:59:00Z'), latestOutcome: 'completed',
        }) as unknown as Record<string, unknown>;
        let writes = 0;
        db.update.mockImplementation(async (filter, update) => {
            if (++writes === 1) throw new Error('temporary start write failure');
            if (Array.isArray(update)) {
                const prior = { ...persisted };
                for (const [field, expression] of Object.entries(update[0].$set)) {
                    const value = evaluate(expression, prior);
                    if (value !== undefined) persisted[field] = value;
                }
            } else if (filter.runId === persisted.runId) persisted = { ...persisted, ...update.$set, ...update.$max };
            else return { matchedCount: 0, upsertedCount: 0 };
            return { matchedCount: 1, upsertedCount: 0 };
        });
        const work = deferred<void>();
        const entered = deferred<void>();
        const older = withAlertJobHeartbeat(async () => { entered.resolve(); return work.promise; });
        const olderRejection = expect(older).rejects.toThrow('old failure');
        await entered.promise;
        vi.setSystemTime('2026-11-08T10:00:01Z');
        const newer = withAlertJobHeartbeat(async () => {
            if (newerOutcome === 'failed') throw new Error('newer failure');
            return 'new result';
        });
        if (newerOutcome === 'failed') await expect(newer).rejects.toThrow('newer failure');
        else await expect(newer).resolves.toBe('new result');
        const newerSnapshot = { ...persisted };
        vi.setSystemTime('2026-11-08T10:00:02Z');
        work.reject(new Error('old failure'));
        await olderRejection;
        expect(persisted).toEqual(newerSnapshot);
        expect(summarizeAlertHealth(persisted as unknown as JobRunStateRecord, true).status).toBe(newerOutcome === 'completed' ? 'recent' : 'failed');
    });
    it('logs an unmatched recovery without changing the original task failure', async () => {
        db.update.mockRejectedValueOnce(new Error('start unavailable'))
            .mockResolvedValueOnce({ matchedCount: 0, upsertedCount: 0 })
            .mockResolvedValueOnce({ matchedCount: 0, upsertedCount: 0 });
        const error = new Error('original task error');
        await expect(withAlertJobHeartbeat(async () => { throw error; })).rejects.toBe(error);
        expect(console.error).toHaveBeenCalledWith('Alert job heartbeat failed recovery matched no record');
    });
});

describe('single job document fences concurrent and delayed attempts', () => {
    it('a delayed old start and its failure cannot replace a newer completed run', async () => {
        let persisted: Record<string, unknown> = {};
        const delayedStart = deferred<void>();
        const firstWriteEntered = deferred<void>();
        let writes = 0;
        db.update.mockImplementation(async (filter, update) => {
            if (++writes === 1) { firstWriteEntered.resolve(); await delayedStart.promise; }
            if (Array.isArray(update)) {
                const prior = { ...persisted };
                for (const [field, expression] of Object.entries(update[0].$set)) {
                    const value = evaluate(expression, prior);
                    if (value !== undefined) persisted[field] = value;
                }
            } else if (persisted.runId === filter.runId) {
                persisted = { ...persisted, ...update.$set, ...update.$max };
            } else return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        });
        const first = withAlertJobHeartbeat(async () => { throw new Error('old failed run'); });
        const firstRejection = expect(first).rejects.toThrow('old failed run');
        await firstWriteEntered.promise;
        vi.setSystemTime('2026-11-08T10:00:01Z');
        await withAlertJobHeartbeat(async () => 'new run completed');
        const newerRun = persisted.runId;
        delayedStart.resolve();
        await firstRejection;
        expect(persisted).toMatchObject({ runId: newerRun, latestOutcome: 'completed', lastStartedAt: new Date('2026-11-08T10:00:01Z') });
        expect(persisted).not.toHaveProperty('lastFailedAt');
    });
    it('a newer failed run cannot be hidden by an older late completion', async () => {
        let persisted: Record<string, unknown> = {};
        db.update.mockImplementation(async (filter, update) => {
            if (Array.isArray(update)) {
                const prior = { ...persisted };
                for (const [field, expression] of Object.entries(update[0].$set)) {
                    const value = evaluate(expression, prior);
                    if (value !== undefined) persisted[field] = value;
                }
            } else if (persisted.runId === filter.runId) persisted = { ...persisted, ...update.$set, ...update.$max };
            else return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        });
        const work = deferred<void>();
        const entered = deferred<void>();
        const older = withAlertJobHeartbeat(async () => { entered.resolve(); return work.promise; });
        await entered.promise;
        vi.setSystemTime('2026-11-08T10:00:01Z');
        await expect(withAlertJobHeartbeat(async () => { throw new Error('new failure'); })).rejects.toThrow('new failure');
        work.resolve();
        await older;
        expect(persisted.latestOutcome).toBe('failed');
        expect(persisted).not.toHaveProperty('lastCompletedAt');
    });
});
