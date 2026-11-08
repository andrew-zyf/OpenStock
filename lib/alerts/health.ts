import { randomUUID } from 'node:crypto';
import { JobRunState, type JobRunStateRecord } from '@/database/models/job-run-state.model';
import { connectToDatabase } from '@/database/mongoose';

export const ALERT_JOB_ID = 'check-stock-alerts';
export const ALERT_JOB_INTERVAL_SECONDS = 300;
export const ALERT_JOB_OVERDUE_SECONDS = 900;

export type AlertHealthSummary = {
    status: 'cached-mode' | 'unknown' | 'no-heartbeat' | 'recent' | 'overdue' | 'failed';
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
    checkedAt: string;
    expectedIntervalSeconds: number;
    overdueAfterSeconds: number;
};

/** Allowlist only. Reading this summary is not evidence that a worker ran. */
export function summarizeAlertHealth(record: JobRunStateRecord | null, enabled: boolean, now = new Date(), unavailable = false): AlertHealthSummary {
    const iso = (value: Date | undefined) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
    const lastStartedAt = enabled ? iso(record?.lastStartedAt) : null;
    const lastCompletedAt = enabled ? iso(record?.lastCompletedAt) : null;
    const lastFailedAt = enabled ? iso(record?.lastFailedAt) : null;
    const futureEvidence = [lastStartedAt, lastCompletedAt, lastFailedAt].some(value => value && Date.parse(value) > now.getTime());
    let status: AlertHealthSummary['status'];
    if (!enabled) status = 'cached-mode';
    else if (unavailable || futureEvidence) status = 'unknown';
    else if (record?.latestOutcome === 'failed' && lastFailedAt) status = 'failed';
    else if (!lastCompletedAt) status = 'no-heartbeat';
    else status = now.getTime() - Date.parse(lastCompletedAt) <= ALERT_JOB_OVERDUE_SECONDS * 1000 ? 'recent' : 'overdue';
    return {
        status, lastStartedAt, lastCompletedAt, lastFailedAt, checkedAt: now.toISOString(),
        expectedIntervalSeconds: ALERT_JOB_INTERVAL_SECONDS, overdueAfterSeconds: ALERT_JOB_OVERDUE_SECONDS,
    };
}

/** Only scheduled execution calls this wrapper. Every attempt gets its own fencing token. */
export async function withAlertJobHeartbeat<T>(task: () => Promise<T>): Promise<T> {
    const runId = randomUUID();
    const startedAt = new Date();
    // A later start wins atomically, even when an earlier start write arrives late.
    const acceptsStart = { $or: [
        { $eq: [{ $ifNull: ['$lastStartedAt', null] }, null] },
        { $lt: ['$lastStartedAt', startedAt] },
        { $and: [{ $eq: ['$lastStartedAt', startedAt] }, { $lt: ['$runId', runId] }] },
    ] };
    try {
        await connectToDatabase();
        await JobRunState.updateOne({ _id: ALERT_JOB_ID }, [{ $set: {
            runId: { $cond: [acceptsStart, runId, '$runId'] },
            lastStartedAt: { $cond: [acceptsStart, startedAt, '$lastStartedAt'] },
        } }], { upsert: true });
    } catch {
        console.error('Alert job heartbeat start could not be persisted');
    }
    const finish = async (outcome: 'completed' | 'failed') => {
        try {
            await connectToDatabase();
            const finishedAt = new Date();
            const timestampField = outcome === 'completed' ? 'lastCompletedAt' : 'lastFailedAt';
            // An older run cannot overwrite the result of a newer start.
            const result = await JobRunState.updateOne({ _id: ALERT_JOB_ID, runId }, {
                $set: { latestOutcome: outcome },
                $max: { [timestampField]: finishedAt },
            });
            if (result.matchedCount === 0) {
                // The start write may have failed before this token was stored. Recover
                // the actual outcome atomically, only if no later start has taken over.
                const recovered = await JobRunState.updateOne({ _id: ALERT_JOB_ID }, [{ $set: {
                    runId: { $cond: [acceptsStart, runId, '$runId'] },
                    lastStartedAt: { $cond: [acceptsStart, startedAt, '$lastStartedAt'] },
                    latestOutcome: { $cond: [acceptsStart, outcome, '$latestOutcome'] },
                    [timestampField]: { $cond: [acceptsStart, { $max: [`$${timestampField}`, finishedAt] }, `$${timestampField}`] },
                } }], { upsert: true });
                if (recovered.matchedCount === 0 && recovered.upsertedCount === 0) {
                    console.error(`Alert job heartbeat ${outcome} recovery matched no record`);
                }
            }
        } catch {
            console.error(`Alert job heartbeat ${outcome} could not be persisted`);
        }
    };
    let result: T;
    try {
        result = await task();
    } catch (error) {
        await finish('failed');
        throw error;
    }
    await finish('completed');
    return result;
}
