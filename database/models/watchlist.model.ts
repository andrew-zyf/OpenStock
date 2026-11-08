import { Schema, model, models, type Document, type Model } from 'mongoose';
import { OBSERVATION_LIMITS, REVIEW_STATUSES, type InitialSnapshot, type ReviewStatus } from '@/lib/watchlist-observation';

export interface WatchlistItem extends Document {
    userId: string;
    symbol: string;
    company: string;
    addedAt: Date;
    group?: string | null;
    note?: string | null;
    invalidation?: string | null;
    targetPrice?: number | null;
    reviewStatus?: ReviewStatus;
    reviewedAt?: Date | null;
    observationUpdatedAt?: Date;
    initialSnapshot?: InitialSnapshot;
}

const InitialSnapshotSchema = new Schema<InitialSnapshot>({
    price: { type: Number, required: true, min: Number.MIN_VALUE },
    currency: { type: String, required: true },
    source: { type: String, required: true },
    asOf: { type: String, required: true },
    fetchedAt: { type: String, required: true },
    priceBasis: { type: String, enum: ['last-trade'], required: true },
    adjustment: { type: String, enum: ['unadjusted'], required: true },
}, { _id: false });

const WatchlistSchema = new Schema<WatchlistItem>(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        company: { type: String, required: true, trim: true },
        addedAt: { type: Date, default: Date.now },
        group: { type: String, trim: true, maxlength: OBSERVATION_LIMITS.group },
        note: { type: String, trim: true, maxlength: OBSERVATION_LIMITS.note },
        invalidation: { type: String, trim: true, maxlength: OBSERVATION_LIMITS.invalidation },
        targetPrice: { type: Number, min: Number.MIN_VALUE, validate: (value: number | null) => value == null || Number.isFinite(value) },
        reviewStatus: { type: String, enum: REVIEW_STATUSES },
        reviewedAt: { type: Date },
        observationUpdatedAt: { type: Date },
        initialSnapshot: { type: InitialSnapshotSchema, immutable: true },
    },
    { timestamps: false }
);

// Prevent duplicate symbols per user
WatchlistSchema.index({ userId: 1, symbol: 1 }, { unique: true });

export const Watchlist: Model<WatchlistItem> =
    (models?.Watchlist as Model<WatchlistItem>) || model<WatchlistItem>('Watchlist', WatchlistSchema);