import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { AlertDelivery, AlertMode, AlertObservation, AlertTriggerEvent } from '@/lib/alerts/evaluation';

export interface IAlert extends Document {
    userId: string;
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    mode?: AlertMode;
    lastObservation?: AlertObservation;
    triggerEvent?: AlertTriggerEvent;
    delivery?: AlertDelivery;
    active: boolean;
    triggered: boolean;
    expiresAt: Date;
    createdAt: Date;
}

const ObservationSchema = new Schema<AlertObservation>({
    price: { type: Number, required: true, min: Number.MIN_VALUE },
    asOf: { type: String, required: true },
    source: { type: String, required: true },
}, { _id: false });

const AlertSchema = new Schema<IAlert>(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        targetPrice: { type: Number, required: true, min: Number.MIN_VALUE },
        condition: { type: String, enum: ['ABOVE', 'BELOW'], required: true },
        // No default: existing records keep their legacy threshold behavior.
        mode: { type: String, enum: ['crossing', 'legacy-threshold'] },
        lastObservation: { type: ObservationSchema, default: undefined },
        triggerEvent: {
            type: new Schema<AlertTriggerEvent>({
                id: { type: String, required: true },
                price: { type: Number, required: true },
                asOf: { type: String, required: true },
                source: { type: String, required: true },
                direction: { type: String, enum: ['ABOVE', 'BELOW'], required: true },
                observedAt: { type: String, required: true },
                previousObservation: { type: ObservationSchema, default: undefined },
            }, { _id: false }),
            default: undefined,
        },
        delivery: {
            type: new Schema<AlertDelivery>({
                status: { type: String, enum: ['pending', 'sent', 'skipped', 'failed'], required: true },
                attemptedAt: String,
                completedAt: String,
                reason: String,
                messageId: String,
            }, { _id: false }),
            default: undefined,
        },
        active: { type: Boolean, default: true },
        triggered: { type: Boolean, default: false },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
        createdAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

export const Alert: Model<IAlert> = (models?.Alert as Model<IAlert>) || model<IAlert>('Alert', AlertSchema);
