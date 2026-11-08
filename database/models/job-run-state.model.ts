import { Schema, model, models, type Model } from 'mongoose';

/** One bounded document per scheduled job. Never stores users, quotes or raw errors. */
export interface JobRunStateRecord {
    _id: string;
    runId: string;
    lastStartedAt: Date;
    lastCompletedAt?: Date;
    lastFailedAt?: Date;
    latestOutcome?: 'completed' | 'failed';
}

const JobRunStateSchema = new Schema<JobRunStateRecord>({
    _id: { type: String, required: true },
    runId: { type: String, required: true },
    lastStartedAt: { type: Date, required: true },
    lastCompletedAt: Date,
    lastFailedAt: Date,
    latestOutcome: { type: String, enum: ['completed', 'failed'] },
}, { versionKey: false });

export const JobRunState: Model<JobRunStateRecord> = (models?.JobRunState as Model<JobRunStateRecord>)
    || model<JobRunStateRecord>('JobRunState', JobRunStateSchema);
