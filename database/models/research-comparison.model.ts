import { Schema, model, models, type Model } from 'mongoose';
import type { ResearchComparisonPayload } from '@/lib/research-comparisons';

/** Explicitly saved evidence only. Ephemeral drafts never enter this collection. */
export interface IResearchComparison extends ResearchComparisonPayload {
    _id: Schema.Types.ObjectId;
    userId: string;
    requestId: string;
    draftId: string;
    createdAt: Date;
    savedAt: Date;
}
const ResearchComparisonSchema = new Schema<IResearchComparison>({
    userId: { type: String, required: true, immutable: true },
    requestId: { type: String, required: true, maxlength: 100, immutable: true },
    draftId: { type: String, required: true, maxlength: 100, immutable: true },
    caption: { type: String, required: true, maxlength: 2000, immutable: true },
    algorithmVersion: { type: String, required: true, immutable: true },
    result: { type: Schema.Types.Mixed, required: true, immutable: true },
    originalSeries: { type: Schema.Types.Mixed, required: true, immutable: true },
    observationReference: { type: Schema.Types.Mixed, immutable: true },
    originalObservation: { type: Schema.Types.Mixed, immutable: true },
    createdAt: { type: Date, required: true, immutable: true },
    savedAt: { type: Date, required: true, immutable: true },
}, { versionKey: false });
ResearchComparisonSchema.index({ userId: 1, requestId: 1 }, { unique: true });
ResearchComparisonSchema.index({ userId: 1, draftId: 1 }, { unique: true });
ResearchComparisonSchema.index({ userId: 1, _id: -1 });
export const ResearchComparisonRecord: Model<IResearchComparison> =
    (models?.ResearchComparisonRecord as Model<IResearchComparison>) || model<IResearchComparison>('ResearchComparisonRecord', ResearchComparisonSchema);
