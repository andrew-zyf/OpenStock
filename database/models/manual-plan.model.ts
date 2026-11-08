import { Schema, model, models, type Model } from 'mongoose';
import { MANUAL_PLAN_LIMIT, MANUAL_PLAN_TEXT_LIMIT, MANUAL_STATES, type ManualPlanFields, type ManualState } from '@/lib/manual-plan';

export type StoredManualPlan = ManualPlanFields & {
    id: string; symbol: string; manualState: ManualState; version: number;
    clientRequestId: string; createFingerprint: string; createdAt: Date; updatedAt: Date;
};
export interface IManualPlanBook { userId: string; plans: StoredManualPlan[] }
const PlanSchema = new Schema<StoredManualPlan>({
    id: { type: String, required: true }, symbol: { type: String, required: true, maxlength: 30 },
    waitingCondition: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    invalidation: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    nextAction: { type: String, required: true, maxlength: MANUAL_PLAN_TEXT_LIMIT },
    checkDate: { type: String, required: true },
    manualState: { type: String, required: true, enum: MANUAL_STATES },
    version: { type: Number, required: true, min: 1 },
    clientRequestId: { type: String, required: true, maxlength: 80 },
    createFingerprint: { type: String, required: true, maxlength: 40000 },
    createdAt: { type: Date, required: true }, updatedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });
// One bounded book per owner makes capacity and request deduplication a single-document CAS.
// Terminal plans remain here; no history is silently deleted to free capacity.
const ManualPlanBookSchema = new Schema<IManualPlanBook>({
    userId: { type: String, required: true, unique: true },
    plans: { type: [PlanSchema], default: [], validate: (plans: StoredManualPlan[]) => plans.length <= MANUAL_PLAN_LIMIT },
}, { strict: 'throw' });
export const ManualPlanBook: Model<IManualPlanBook> = (models?.ManualPlanBook as Model<IManualPlanBook>) || model<IManualPlanBook>('ManualPlanBook', ManualPlanBookSchema);
