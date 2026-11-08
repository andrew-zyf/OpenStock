import { Schema, model, models, type Model } from 'mongoose';
import type { PeerMember } from '@/lib/market/daily-research';

export interface IPeerGroup {
    _id: Schema.Types.ObjectId;
    userId: string;
    slot: number;
    name: string;
    purpose: 'peer' | 'theme';
    members: PeerMember[];
    membershipSavedAt: Date;
}

const MemberSchema = new Schema<PeerMember>({
    symbolId: { type: String, required: true, immutable: true },
    symbol: { type: String, required: true, immutable: true },
}, { _id: false });
const PeerGroupSchema = new Schema<IPeerGroup>({
    userId: { type: String, required: true, immutable: true },
    slot: { type: Number, required: true, min: 0, max: 9, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 60, immutable: true },
    purpose: { type: String, enum: ['peer', 'theme'], default: 'peer', immutable: true },
    members: { type: [MemberSchema], required: true, immutable: true, validate: (members: PeerMember[]) => members.length > 0 && members.length <= 20 && new Set(members.map(member => member.symbolId)).size === members.length },
    membershipSavedAt: { type: Date, required: true, immutable: true },
});
// A unique bounded slot enforces the per-owner cap even under concurrent creates.
PeerGroupSchema.index({ userId: 1, slot: 1 }, { unique: true });
export const PeerGroupRecord: Model<IPeerGroup> = (models?.PeerGroupRecord as Model<IPeerGroup>) || model<IPeerGroup>('PeerGroupRecord', PeerGroupSchema);
