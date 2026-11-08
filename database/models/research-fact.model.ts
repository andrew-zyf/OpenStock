import { Schema, model, models, type Model } from 'mongoose';
import { FACT_ASSESSMENTS, FACT_TEXT_LIMIT, FACT_TYPES, type ResearchFactRecord, validateResearchFactRecord } from '@/lib/research-facts';

export type StoredResearchFact = Omit<ResearchFactRecord, 'createdAt'> & {
    userId: string; createdAt: Date; clientRequestId: string; createFingerprint: string;
};
const ResearchFactSchema = new Schema<StoredResearchFact>({
    userId: { type: String, required: true, immutable: true },
    id: { type: String, required: true, immutable: true },
    symbol: { type: String, required: true, immutable: true },
    market: { type: String, enum: ['cn', 'hk', 'tw', 'us'], required: true, immutable: true },
    exchangeId: { type: String, enum: ['SSE', 'SZSE', 'BSE', 'HKEX', 'TWSE', 'TPEX', 'US'], required: true, immutable: true },
    factType: { type: String, enum: [...new Set(Object.values(FACT_TYPES).flat())], required: true, immutable: true },
    reportingPeriod: { type: String, required: true, maxlength: 160, immutable: true },
    title: { type: String, required: true, maxlength: 200, immutable: true },
    factText: { type: String, required: true, maxlength: FACT_TEXT_LIMIT, immutable: true },
    sourceUrl: { type: String, required: true, maxlength: 2000, immutable: true },
    sourcePublishedAt: { type: String, default: null, immutable: true },
    // This is the server's manual registration time. No official source is fetched by this feature.
    createdAt: { type: Date, required: true, immutable: true },
    registrationMethod: { type: String, enum: ['manual'], required: true, immutable: true },
    assessment: { type: String, enum: FACT_ASSESSMENTS, required: true, immutable: true },
    assessmentNote: { type: String, default: '', maxlength: 2000, immutable: true },
    observationSnapshot: { type: Schema.Types.Mixed, default: null, immutable: true },
    correctionOf: { type: String, default: null, immutable: true },
    correctionReason: { type: String, default: null, maxlength: 2000, immutable: true },
    rootId: { type: String, required: true, immutable: true },
    version: { type: Number, min: 1, required: true, immutable: true },
    clientRequestId: { type: String, required: true, immutable: true },
    createFingerprint: { type: String, required: true, immutable: true },
}, { versionKey: false, timestamps: false, strict: 'throw' });
ResearchFactSchema.pre('validate', function () {
    const { _id, userId, clientRequestId, createFingerprint, ...record } = this.toObject();
    void _id; void userId; void clientRequestId; void createFingerprint;
    validateResearchFactRecord({ ...record, createdAt: this.createdAt?.toISOString() });
});
ResearchFactSchema.index({ userId: 1, id: 1 }, { unique: true });
ResearchFactSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
// A correction extends the latest immutable document, rather than forking or overwriting it.
ResearchFactSchema.index({ userId: 1, correctionOf: 1 }, { unique: true, partialFilterExpression: { correctionOf: { $type: 'string' } } });
ResearchFactSchema.index({ userId: 1, createdAt: -1, id: -1 });
ResearchFactSchema.index({ userId: 1, symbol: 1, createdAt: -1, id: -1 });
export const ResearchFact: Model<StoredResearchFact> = (models?.ResearchFact as Model<StoredResearchFact>) || model<StoredResearchFact>('ResearchFact', ResearchFactSchema);
