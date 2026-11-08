import { Schema, model, models, type Model } from 'mongoose';

export type EventVersion = {
    id: string; date: string; previousDate?: string; discoveredAt: string;
    source: string; sourceUrl?: string; title: string;
};
export type ResearchEventHistory = {
    userId: string; identity: string; symbol: string; revision: number;
    observedAt: Date; versions: EventVersion[];
};
export type ResearchChangeStatus = 'pending' | 'processed' | 'snoozed' | 'ignored';
export type ResearchChangeState = {
    userId: string; changeId: string; status: ResearchChangeStatus;
    snoozedUntil?: Date | null; revision: number; updatedAt: Date;
};
const EventVersionSchema = new Schema<EventVersion>({
    id: { type: String, required: true }, date: { type: String, required: true }, previousDate: String,
    discoveredAt: { type: String, required: true }, source: { type: String, required: true },
    sourceUrl: String, title: { type: String, required: true },
}, { _id: false });
const EventHistorySchema = new Schema<ResearchEventHistory>({
    userId: { type: String, required: true }, identity: { type: String, required: true },
    symbol: { type: String, required: true }, revision: { type: Number, required: true },
    observedAt: { type: Date, required: true }, versions: { type: [EventVersionSchema], required: true },
});
EventHistorySchema.index({ userId: 1, identity: 1 }, { unique: true });
EventHistorySchema.index({ userId: 1, symbol: 1, observedAt: -1 });
const ChangeStateSchema = new Schema<ResearchChangeState>({
    userId: { type: String, required: true }, changeId: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending', 'processed', 'snoozed', 'ignored'] },
    snoozedUntil: Date, revision: { type: Number, required: true }, updatedAt: { type: Date, required: true },
});
ChangeStateSchema.index({ userId: 1, changeId: 1 }, { unique: true });
export const ResearchEventHistoryRecord: Model<ResearchEventHistory> =
    (models?.ResearchEventHistoryRecord as Model<ResearchEventHistory>) || model<ResearchEventHistory>('ResearchEventHistoryRecord', EventHistorySchema);
export const ResearchChangeStateRecord: Model<ResearchChangeState> =
    (models?.ResearchChangeStateRecord as Model<ResearchChangeState>) || model<ResearchChangeState>('ResearchChangeStateRecord', ChangeStateSchema);
