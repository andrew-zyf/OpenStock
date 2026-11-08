'use server';

import { randomUUID } from 'node:crypto';
import { connectToDatabase } from '@/database/mongoose';
import { ManualPlanBook, type StoredManualPlan } from '@/database/models/manual-plan.model';
import { requireUserId } from '@/lib/better-auth/auth';
import {
    MANUAL_PLAN_LIMIT, manualPlanFingerprint, validateCreateManualPlan, validateUpdateManualPlan,
    type CreateManualPlanInput, type ManualPlan, type UpdateManualPlanInput,
} from '@/lib/manual-plan';

function publicPlan(plan: StoredManualPlan): ManualPlan {
    return {
        id: plan.id, symbol: plan.symbol, waitingCondition: plan.waitingCondition,
        invalidation: plan.invalidation, nextAction: plan.nextAction, checkDate: plan.checkDate,
        manualState: plan.manualState, version: plan.version,
        createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(),
    };
}
function retry(plans: StoredManualPlan[], requestId: string, fingerprint: string): ManualPlan | undefined {
    const saved = plans.find((plan) => plan.clientRequestId === requestId);
    if (!saved) return undefined;
    if (saved.createFingerprint !== fingerprint) throw new Error('请求标识已用于其他计划内容，请重新提交');
    return publicPlan(saved);
}

export async function getManualPlans(): Promise<ManualPlan[]> {
    const userId = await requireUserId();
    await connectToDatabase();
    const book = await ManualPlanBook.findOne({ userId }).lean();
    return (book?.plans ?? []).map(publicPlan).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export async function createManualPlan(input: CreateManualPlanInput): Promise<ManualPlan> {
    const userId = await requireUserId();
    const value = validateCreateManualPlan(input);
    const fingerprint = manualPlanFingerprint(value);
    await connectToDatabase();
    let book = await ManualPlanBook.findOne({ userId }).lean();
    if (!book) {
        try {
            book = await ManualPlanBook.findOneAndUpdate({ userId }, { $setOnInsert: { userId, plans: [] } }, { upsert: true, new: true }).lean();
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) throw error;
            // A simultaneous first request may have created this user's unique book.
            book = await ManualPlanBook.findOne({ userId }).lean();
            if (!book) throw error;
        }
    }
    const duplicate = retry(book?.plans ?? [], value.clientRequestId, fingerprint);
    if (duplicate) return duplicate;
    const now = new Date();
    const plan: StoredManualPlan = {
        ...value, id: randomUUID(), createFingerprint: fingerprint,
        manualState: 'waiting', version: 1, createdAt: now, updatedAt: now,
    };
    const saved = await ManualPlanBook.findOneAndUpdate({
        userId, 'plans.clientRequestId': { $ne: value.clientRequestId },
        [`plans.${MANUAL_PLAN_LIMIT - 1}`]: { $exists: false },
    }, { $push: { plans: plan } }, { new: true, runValidators: true }).lean();
    if (saved) return publicPlan(saved.plans.find((item) => item.id === plan.id)!);
    // Capacity and deduplication were checked atomically; inspect the winner of a retry race.
    const latest = await ManualPlanBook.findOne({ userId }).lean();
    const winner = retry(latest?.plans ?? [], value.clientRequestId, fingerprint);
    if (winner) return winner;
    throw new Error('最多保留 100 条人工计划（含已完成和已取消），本次未保存');
}

export async function updateManualPlan(
    id: string, input: UpdateManualPlanInput, expectedVersion: number,
): Promise<{ success: true; plan: ManualPlan } | { success: false; code: 'NOT_FOUND' | 'CONFLICT'; error: string }> {
    const userId = await requireUserId();
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('无效的计划编号');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER) throw new Error('无效的计划版本');
    const patch = validateUpdateManualPlan(input);
    const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => [`plans.$.${key}`, value]));
    await connectToDatabase();
    const saved = await ManualPlanBook.findOneAndUpdate({
        userId, plans: { $elemMatch: { id, version: expectedVersion } },
    }, {
        $set: { ...fields, 'plans.$.updatedAt': new Date() }, $inc: { 'plans.$.version': 1 },
    }, { new: true, runValidators: true }).lean();
    if (saved) return { success: true, plan: publicPlan(saved.plans.find((plan) => plan.id === id)!) };
    const latest = await ManualPlanBook.findOne({ userId, 'plans.id': id }).lean();
    return latest ? { success: false, code: 'CONFLICT', error: '计划已在其他页面更新，请重新读取后核对；输入仍保留' }
        : { success: false, code: 'NOT_FOUND', error: '未找到当前账户的人工计划' };
}
