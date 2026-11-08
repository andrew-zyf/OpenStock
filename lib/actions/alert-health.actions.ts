'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { connectToDatabase } from '@/database/mongoose';
import { JobRunState } from '@/database/models/job-run-state.model';
import { alertsEnabled } from '@/lib/market-data';
import { ALERT_JOB_ID, summarizeAlertHealth, type AlertHealthSummary } from '@/lib/alerts/health';

/** Authenticated, read-only health evidence. No user identifiers or internal error details. */
export async function getAlertHealthStatus(): Promise<AlertHealthSummary> {
    await requireUserId();
    if (!alertsEnabled) return summarizeAlertHealth(null, false);
    try {
        await connectToDatabase();
        const record = await JobRunState.findById(ALERT_JOB_ID)
            .select('lastStartedAt lastCompletedAt lastFailedAt latestOutcome').lean();
        return summarizeAlertHealth(record, true);
    } catch {
        console.error('Alert job health summary could not be read');
        return summarizeAlertHealth(null, true, new Date(), true);
    }
}
