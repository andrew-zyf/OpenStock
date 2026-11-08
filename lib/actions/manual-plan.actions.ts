'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import {
    validateCreateManualPlan, validateManualPlanId, validateManualPlanVersion, validateUpdateManualPlan,
    type CreateManualPlanInput, type ManualPlan, type ManualPlanFailure, type ManualPlanPage,
    type ManualPlanPageOptions, type ManualPlanResult, type ManualPlanSchedule, type UpdateManualPlanInput,
} from '@/lib/manual-plan';
import {
    createStoredManualPlan, getManualPlanById, listManualPlans, listManualPlanScheduleHistory,
    updateStoredManualPlan, validateManualPlanPageOptions,
} from '@/lib/manual-plan-store';
import { WatchlistLifecycleError } from '@/lib/watchlist-lifecycle';

function invalid(error: unknown): ManualPlanFailure {
    return { success: false, code: 'INVALID', error: error instanceof Error ? error.message : '无效的人工计划输入' };
}
async function coordinated<T>(operation: () => Promise<T>): Promise<T | ManualPlanFailure> {
    try { return await operation(); }
    catch (error) {
        if (error instanceof WatchlistLifecycleError) return error.failure();
        throw error;
    }
}
export async function getManualPlans(options: ManualPlanPageOptions = {}): Promise<ManualPlanResult<ManualPlanPage>> {
    const userId = await requireUserId();
    try { validateManualPlanPageOptions(options); } catch (error) { return invalid(error); }
    return coordinated(async () => ({ success: true as const, ...await listManualPlans(userId, options) }));
}
export async function getManualPlan(id: string): Promise<ManualPlanResult<{ plan: ManualPlan }>> {
    const userId = await requireUserId();
    try { validateManualPlanId(id); } catch (error) { return invalid(error); }
    return coordinated(() => getManualPlanById(userId, id));
}
export async function createManualPlan(input: CreateManualPlanInput): Promise<ManualPlanResult<{ plan: ManualPlan }>> {
    const userId = await requireUserId();
    let value: CreateManualPlanInput;
    try { value = validateCreateManualPlan(input); } catch (error) { return invalid(error); }
    return coordinated(() => createStoredManualPlan(userId, value));
}
export async function updateManualPlan(id: string, input: UpdateManualPlanInput, expectedVersion: number): Promise<ManualPlanResult<{ plan: ManualPlan }>> {
    const userId = await requireUserId();
    let patch: UpdateManualPlanInput;
    try {
        validateManualPlanId(id); validateManualPlanVersion(expectedVersion);
        patch = validateUpdateManualPlan(input);
    } catch (error) { return invalid(error); }
    return coordinated(() => updateStoredManualPlan(userId, id, patch, expectedVersion));
}
export async function getManualPlanScheduleHistory(id: string, beforeRevision?: number): Promise<ManualPlanResult<{ history: ManualPlanSchedule[]; nextCursor?: number }>> {
    const userId = await requireUserId();
    try {
        validateManualPlanId(id);
        if (beforeRevision !== undefined) validateManualPlanVersion(beforeRevision);
    } catch (error) { return invalid(error); }
    return coordinated(() => listManualPlanScheduleHistory(userId, id, beforeRevision));
}
