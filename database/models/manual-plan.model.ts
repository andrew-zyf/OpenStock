import { Schema, model, models, type Model } from 'mongoose';
import { MANUAL_PLAN_LIMIT, MANUAL_PLAN_TEXT_LIMIT, MANUAL_PLAN_OBSERVATION_TEXT_LIMIT, MANUAL_STATES, type ManualPlanFields, type ManualPlanObservation, type ManualState } from '@/lib/manual-plan';
import { validCalendarDate } from '@/lib/market/dates';

export type StoredManualPlan = ManualPlanFields & {
    id: string; symbol: string; manualState: ManualState; version: number;
    clientRequestId: string; createFingerprint: string; createdAt: Date; updatedAt: Date;
    /** Absent on untouched legacy records; public readers expose revision 1. */
    scheduleRevision?: number;
    stateReason?: string; observationVersionId?: string; observationSnapshot?: ManualPlanObservation;
};
export interface IManualPlanBook { userId: string; plans: StoredManualPlan[] }
export type StoredManualPlanRecord = StoredManualPlan & { userId: string };
export type StoredManualPlanSchedule = {
    userId: string; planId: string; revision: number; fromDate: string; toDate: string; reason: string; changedAt: Date;
};
const integer = (value: number) => Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER;
const calendarDate = (value: string) => validCalendarDate(value) && value >= '1900-01-01' && value <= '9999-12-31';
const ObservationSchema = new Schema<ManualPlanObservation>({
    recordedAt: { type: String, required: true },
    note: { type: String, maxlength: MANUAL_PLAN_OBSERVATION_TEXT_LIMIT }, invalidation: { type: String, maxlength: MANUAL_PLAN_OBSERVATION_TEXT_LIMIT },
}, { _id: false, strict: 'throw' });
const planFields = {
    id: { type: String, required: true }, symbol: { type: String, required: true, maxlength: 30 },
    waitingCondition: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    invalidation: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    nextAction: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    checkDate: { type: String, required: true, validate: calendarDate },
    manualState: { type: String, required: true, enum: MANUAL_STATES },
    version: { type: Number, required: true, min: 1, validate: integer },
    scheduleRevision: { type: Number, min: 1, validate: integer },
    stateReason: { type: String, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    observationVersionId: { type: String, maxlength: 100 }, observationSnapshot: { type: ObservationSchema },
    clientRequestId: { type: String, required: true, maxlength: 80 },
    createFingerprint: { type: String, required: true, maxlength: 40000 },
    createdAt: { type: Date, required: true }, updatedAt: { type: Date, required: true },
};
const PlanSchema = new Schema<StoredManualPlan>(planFields, { _id: false, strict: 'throw' });
// Legacy books stay untouched. New writes never grow this BSON document or remove its history.
const ManualPlanBookSchema = new Schema<IManualPlanBook>({
    userId: { type: String, required: true, unique: true },
    plans: { type: [PlanSchema], default: [], validate: (plans: StoredManualPlan[]) => plans.length <= MANUAL_PLAN_LIMIT },
}, { strict: 'throw' });
export const ManualPlanBook: Model<IManualPlanBook> = (models?.ManualPlanBook as Model<IManualPlanBook>) || model<IManualPlanBook>('ManualPlanBook', ManualPlanBookSchema);

// Copy only paths: adding the subdocument Schema also copies its {_id:false} option,
// which would make actual Mongoose saves reject before reaching the collection.
const ManualPlanRecordSchema = new Schema<StoredManualPlanRecord>({
    ...planFields, userId: { type: String, required: true },
}, { strict: 'throw', versionKey: false });
ManualPlanRecordSchema.index({ userId: 1, id: 1 }, { unique: true });
ManualPlanRecordSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
ManualPlanRecordSchema.index({ userId: 1, manualState: 1, createdAt: -1, id: 1 });
ManualPlanRecordSchema.index({ userId: 1, createdAt: -1, id: 1 });
export const ManualPlanRecord: Model<StoredManualPlanRecord> = (models?.ManualPlanRecord as Model<StoredManualPlanRecord>) || model<StoredManualPlanRecord>('ManualPlanRecord', ManualPlanRecordSchema);

// Each explicit schedule change is separate, so repeated rescheduling cannot grow one plan forever.
const ManualPlanScheduleSchema = new Schema<StoredManualPlanSchedule>({
    userId: { type: String, required: true }, planId: { type: String, required: true },
    revision: { type: Number, required: true, min: 2, validate: integer },
    fromDate: { type: String, required: true, validate: calendarDate }, toDate: { type: String, required: true, validate: calendarDate },
    reason: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT }, changedAt: { type: Date, required: true },
}, { strict: 'throw', versionKey: false });
ManualPlanScheduleSchema.index({ userId: 1, planId: 1, revision: -1 }, { unique: true });
export const ManualPlanSchedule: Model<StoredManualPlanSchedule> = (models?.ManualPlanSchedule as Model<StoredManualPlanSchedule>) || model<StoredManualPlanSchedule>('ManualPlanSchedule', ManualPlanScheduleSchema);
