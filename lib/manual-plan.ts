import { validCalendarDate } from '@/lib/market/dates';
import { identifyMarketAndCode } from '@/lib/market/instrument';

/** Only waiting plans consume capacity. Retained history is paged separately. */
export const MANUAL_PLAN_LIMIT = 100;
export const MANUAL_PLAN_PAGE_SIZE = 25;
export const MANUAL_PLAN_TEXT_LIMIT = 2000;
/** Historical merged observations can exceed today's editable field limit. Never truncate them. */
export const MANUAL_PLAN_OBSERVATION_TEXT_LIMIT = 14 * 1024 * 1024;
export const MANUAL_STATES = ['waiting', 'completed', 'cancelled'] as const;
export type ManualState = typeof MANUAL_STATES[number];
export type ManualPlanFields = {
    waitingCondition: string;
    invalidation: string;
    nextAction: string;
    /** A date in the symbol's exchange time zone, never a midnight timestamp. */
    checkDate: string;
};
export type CreateManualPlanInput = ManualPlanFields & { symbol: string; clientRequestId: string; observationVersionId?: string };
export type UpdateManualPlanInput = Partial<ManualPlanFields> & { manualState?: ManualState; scheduleReason?: string; stateReason?: string };
export type ManualPlanObservation = { recordedAt: string; note?: string; invalidation?: string };
export type ManualPlan = ManualPlanFields & {
    id: string; symbol: string; manualState: ManualState; version: number;
    /** Stable due identity; only an actual, explicit date change increments it. */
    scheduleRevision: number;
    stateReason?: string; observationVersionId?: string; observationSnapshot?: ManualPlanObservation;
    createdAt: string; updatedAt: string;
};
export type ManualPlanSchedule = {
    planId: string; revision: number; fromDate: string; toDate: string; reason: string; changedAt: string;
};
export type ManualPlanPageOptions = { scope?: 'waiting' | 'history' | 'all'; cursor?: string; limit?: number };
export type ManualPlanPage = { plans: ManualPlan[]; activeCount: number; nextCursor?: string };
export type ManualPlanFailure = {
    success: false;
    code: 'INVALID' | 'CAPACITY' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'CONFLICT' | 'LIFECYCLE_BUSY' | 'LIFECYCLE_MAINTENANCE';
    error: string; retryable?: boolean;
};
export type ManualPlanResult<T> = ({ success: true } & T) | ManualPlanFailure;

const TEXT_FIELDS = ['waitingCondition', 'invalidation', 'nextAction'] as const;
function allowedObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => !keys.includes(key))) throw new Error('无效的人工计划字段');
    return input as Record<string, unknown>;
}
function text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > MANUAL_PLAN_TEXT_LIMIT
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('计划内容须为 1–2000 字有效文本');
    return value.trim();
}
function checkDate(value: unknown): string {
    if (!validCalendarDate(value) || value < '1900-01-01' || value > '9999-12-31') throw new Error('检查日期须为有效的 YYYY-MM-DD 自然日');
    return value;
}
export function validateManualPlanId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('无效的计划编号');
}
export function validateManualPlanVersion(version: unknown): asserts version is number {
    if (!Number.isSafeInteger(version) || (version as number) < 1 || (version as number) >= Number.MAX_SAFE_INTEGER) throw new Error('无效的计划版本');
}
export function validateCreateManualPlan(input: unknown): CreateManualPlanInput {
    const value = allowedObject(input, ['symbol', ...TEXT_FIELDS, 'checkDate', 'clientRequestId', 'observationVersionId']);
    if (typeof value.symbol !== 'string' || !/^[A-Z0-9^][A-Z0-9.^:&-]{0,24}$/i.test(value.symbol.trim())) throw new Error('无效的股票代码');
    const identity = identifyMarketAndCode(value.symbol);
    if (identity.kind === 'unknown') throw new Error('无法识别标的市场身份');
    if (typeof value.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value.clientRequestId)) throw new Error('无效的请求标识');
    if (value.observationVersionId !== undefined && (typeof value.observationVersionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.observationVersionId))) throw new Error('无效的观点版本编号');
    return {
        symbol: identity.normalizedSymbol, waitingCondition: text(value.waitingCondition),
        invalidation: text(value.invalidation), nextAction: text(value.nextAction),
        checkDate: checkDate(value.checkDate), clientRequestId: value.clientRequestId,
        ...(value.observationVersionId !== undefined ? { observationVersionId: value.observationVersionId as string } : {}),
    };
}
export function validateUpdateManualPlan(input: unknown): UpdateManualPlanInput {
    const value = allowedObject(input, [...TEXT_FIELDS, 'checkDate', 'manualState', 'scheduleReason', 'stateReason']);
    const patch: UpdateManualPlanInput = {};
    for (const key of TEXT_FIELDS) if (Object.hasOwn(value, key)) patch[key] = text(value[key]);
    if (Object.hasOwn(value, 'checkDate')) patch.checkDate = checkDate(value.checkDate);
    if (Object.hasOwn(value, 'manualState')) {
        if (!MANUAL_STATES.includes(value.manualState as ManualState)) throw new Error('无效的人工计划状态');
        patch.manualState = value.manualState as ManualState;
    }
    for (const key of ['scheduleReason', 'stateReason'] as const) if (Object.hasOwn(value, key)) patch[key] = text(value[key]);
    if (patch.scheduleReason && !patch.checkDate) throw new Error('调整原因须与检查日期一同保存');
    if (patch.stateReason && !patch.manualState) throw new Error('完成依据或取消原因须与状态一同保存');
    if (!Object.keys(patch).length) throw new Error('请提供要修改的计划内容');
    return patch;
}

/** Immutable initial request, so a retry remains safe after a later edit or cancellation. */
export function manualPlanFingerprint(value: CreateManualPlanInput): string {
    const fields = [value.symbol, value.waitingCondition, value.invalidation, value.nextAction, value.checkDate];
    // Preserve the exact legacy fingerprint for independent plans.
    return JSON.stringify(value.observationVersionId ? [...fields, value.observationVersionId] : fields);
}
