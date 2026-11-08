import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface IMarketEvent extends Document {
    userId: string; symbol: string; title: string; date: string;
    kind: 'earnings' | 'ex-dividend' | 'other'; sourceUrl?: string; note?: string;
    clientRequestId: string; cancelledAt?: Date; createdAt: Date;
}
const MarketEventSchema = new Schema<IMarketEvent>({
    userId: { type: String, required: true, index: true }, symbol: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 }, date: { type: String, required: true },
    kind: { type: String, required: true, enum: ['earnings', 'ex-dividend', 'other'] },
    sourceUrl: String, note: { type: String, maxlength: 2000 }, clientRequestId: { type: String, required: true },
    cancelledAt: Date, createdAt: { type: Date, default: Date.now },
});
MarketEventSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
MarketEventSchema.index({ userId: 1, date: 1 });
export const MarketEventRecord: Model<IMarketEvent> = (models?.MarketEventRecord as Model<IMarketEvent>) || model<IMarketEvent>('MarketEventRecord', MarketEventSchema);
