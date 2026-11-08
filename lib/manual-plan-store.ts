import { randomUUID } from 'node:crypto';
import { BSON } from 'mongodb';
import {
    ManualPlanBook, ManualPlanRecord, ManualPlanSchedule as ScheduleModel,
    type StoredManualPlan, type StoredManualPlanRecord,
} from '@/database/models/manual-plan.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { exchangeDateForSymbol } from '@/lib/market/dates';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import {
    MANUAL_PLAN_LIMIT, MANUAL_PLAN_PAGE_SIZE, manualPlanFingerprint,
    type CreateManualPlanInput, type ManualPlan, type ManualPlanPage, type ManualPlanPageOptions,
    type ManualPlanResult, type ManualPlanSchedule, type UpdateManualPlanInput,
} from '@/lib/manual-plan';
import { withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';

export function publicManualPlan(plan: StoredManualPlan): ManualPlan {
    return {
        id: plan.id, symbol: plan.symbol, waitingCondition: plan.waitingCondition,
        invalidation: plan.invalidation, nextAction: plan.nextAction, checkDate: plan.checkDate,
        manualState: plan.manualState, version: plan.version, scheduleRevision: plan.scheduleRevision ?? 1,
        ...(plan.stateReason ? { stateReason: plan.stateReason } : {}),
        ...(plan.observationVersionId ? { observationVersionId: plan.observationVersionId } : {}),
        ...(plan.observationSnapshot ? { observationSnapshot: {
            recordedAt: plan.observationSnapshot.recordedAt,
            ...(plan.observationSnapshot.note !== undefined ? { note: plan.observationSnapshot.note } : {}),
            ...(plan.observationSnapshot.invalidation !== undefined ? { invalidation: plan.observationSnapshot.invalidation } : {}),
        } } : {}),
        createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(),
    };
}
const failure = (code: 'CAPACITY' | 'REQUEST_CONFLICT' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID', error: string) => ({ success: false, code, error } as const);
const capacity = () => failure('CAPACITY', '最多同时保留 100 条等待中的人工计划；完成或取消后可继续新建，历史继续保留');
const conflict = () => failure('CONFLICT', '计划已在其他页面更新，请重新读取后核对；输入仍保留');
const missing = () => failure('NOT_FOUND', '未找到当前账户的人工计划或关联观点版本');

// These helpers are intentionally private: callers enter the lifecycle lock exactly once.
async function legacyRemainder(userId: string): Promise<StoredManualPlan[]> {
    const book = await ManualPlanBook.findOne({ userId }).lean();
    const legacy = book?.plans ?? [];
    if (!legacy.length) return [];
    const overrides = await ManualPlanRecord.find({ userId, id: { $in: legacy.map((plan) => plan.id) } }).select('id').lean();
    const ids = new Set(overrides.map((plan) => plan.id));
    return legacy.filter((plan) => !ids.has(plan.id));
}
async function findPlan(userId: string, id: string): Promise<{ plan: StoredManualPlan; record: boolean } | undefined> {
    const record = await ManualPlanRecord.findOne({ userId, id }).lean();
    if (record) return { plan: record, record: true };
    const book = await ManualPlanBook.findOne({ userId, 'plans.id': id }).lean();
    const legacy = book?.plans.find((plan) => plan.id === id);
    return legacy ? { plan: legacy, record: false } : undefined;
}
async function waitingCount(userId: string, legacy?: StoredManualPlan[]) {
    return await ManualPlanRecord.countDocuments({ userId, manualState: 'waiting' })
        + (legacy ?? await legacyRemainder(userId)).filter((plan) => plan.manualState === 'waiting').length;
}
// Match MongoDB's default binary string order, including uppercase legacy identifiers.
const compare = (a: StoredManualPlan, b: StoredManualPlan) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
type Cursor = { scope: NonNullable<ManualPlanPageOptions['scope']>; createdAt: string; id: string };
export function validateManualPlanPageOptions(options: ManualPlanPageOptions) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !['scope', 'limit', 'cursor'].includes(key))) throw new Error('无效的计划分页参数');
    const scope = options.scope ?? 'waiting';
    const limit = options.limit ?? MANUAL_PLAN_PAGE_SIZE;
    if (!['waiting', 'history', 'all'].includes(scope) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('无效的计划分页参数');
    let cursor: Cursor | undefined;
    if (options.cursor !== undefined) {
        try {
            if (typeof options.cursor !== 'string' || options.cursor.length > 500) throw new Error();
            const value = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()) as Cursor;
            if (!value || value.scope !== scope || typeof value.id !== 'string' || value.id.length > 100
                || typeof value.createdAt !== 'string' || new Date(value.createdAt).toISOString() !== value.createdAt) throw new Error();
            cursor = value;
        } catch { throw new Error('无效的计划分页游标，请从第一页重新读取'); }
    }
    return { scope, limit, cursor };
}

/** Keyset pagination reads at most one record page plus the bounded, untouched legacy book. */
export async function listManualPlans(userId: string, options: ManualPlanPageOptions = {}): Promise<ManualPlanPage> {
    const { scope, limit, cursor } = validateManualPlanPageOptions(options);
    return withWatchlistLifecycle(userId, { operation: 'manual-plan-list', readOnly: true }, async () => {
        const legacy = await legacyRemainder(userId);
        const stateFilter = scope === 'waiting' ? { manualState: 'waiting' } : scope === 'history' ? { manualState: { $in: ['completed', 'cancelled'] } } : {};
        const filter = { userId, ...stateFilter, ...(cursor ? { $or: [
            { createdAt: { $lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { $gt: cursor.id } },
        ] } : {}) };
        const records = await ManualPlanRecord.find(filter).sort({ createdAt: -1, id: 1 }).limit(limit + 1).lean();
        const candidates = [...records, ...legacy.filter((plan) => {
            const state = scope === 'all' || (scope === 'waiting' ? plan.manualState === 'waiting' : plan.manualState !== 'waiting');
            const after = !cursor || plan.createdAt.getTime() < new Date(cursor.createdAt).getTime()
                || (plan.createdAt.toISOString() === cursor.createdAt && plan.id > cursor.id);
            return state && after;
        })].sort(compare);
        const plans = candidates.slice(0, limit);
        const last = plans.at(-1);
        return {
            plans: plans.map(publicManualPlan), activeCount: await waitingCount(userId, legacy),
            ...(candidates.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ scope, createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') } : {}),
        };
    });
}
export async function getManualPlanById(userId: string, id: string): Promise<ManualPlanResult<{ plan: ManualPlan }>> {
    return withWatchlistLifecycle(userId, { operation: 'manual-plan-read', readOnly: true }, async () => {
        const found = await findPlan(userId, id);
        return found ? { success: true, plan: publicManualPlan(found.plan) } : missing();
    });
}
export async function createStoredManualPlan(userId: string, value: CreateManualPlanInput): Promise<ManualPlanResult<{ plan: ManualPlan }>> {
    const fingerprint = manualPlanFingerprint(value);
    return withWatchlistLifecycle(userId, { operation: 'manual-plan-create', symbol: value.symbol }, async () => {
        const record = await ManualPlanRecord.findOne({ userId, clientRequestId: value.clientRequestId }).lean();
        const book = record ? null : await ManualPlanBook.findOne({ userId, 'plans.clientRequestId': value.clientRequestId }).lean();
        const legacy = book?.plans.find((plan) => plan.clientRequestId === value.clientRequestId);
        const saved = record ?? (legacy ? (await findPlan(userId, legacy.id))?.plan : undefined);
        if (saved) return saved.createFingerprint === fingerprint ? { success: true, plan: publicManualPlan(saved) }
            : failure('REQUEST_CONFLICT', '请求标识已用于其他计划内容，请重新提交');
        if (await waitingCount(userId) >= MANUAL_PLAN_LIMIT) return capacity();
        let observationSnapshot: StoredManualPlan['observationSnapshot'];
        if (value.observationVersionId) {
            const source = await Watchlist.findOne({ userId, journal: { $elemMatch: { kind: 'observation', id: value.observationVersionId } } }).select('symbol +journal').lean();
            const revision = source?.journal?.find((entry) => entry.kind === 'observation' && entry.id === value.observationVersionId);
            if (!source || identifyMarketAndCode(source.symbol).normalizedSymbol !== value.symbol || revision?.kind !== 'observation') return missing();
            observationSnapshot = {
                recordedAt: revision.recordedAt,
                ...(revision.observation.note != null ? { note: revision.observation.note } : {}),
                ...(revision.observation.invalidation != null ? { invalidation: revision.observation.invalidation } : {}),
            };
        }
        const now = new Date();
        const plan: StoredManualPlanRecord = {
            ...value, userId, id: randomUUID(), createFingerprint: fingerprint,
            manualState: 'waiting', version: 1, scheduleRevision: 1, createdAt: now, updatedAt: now,
            ...(observationSnapshot ? { observationSnapshot } : {}),
        };
        // Keep the entire referenced text within the backup's 12 MiB restoration guard.
        // A known size rejection happens before any write and must not strand the shared mutex.
        if (BSON.calculateObjectSize(plan) > 12 * 1024 * 1024) return failure('INVALID', '关联观点原文超过单条计划容量；原文未截断，请保留独立计划并核查原观点');
        await ManualPlanRecord.create(plan);
        return { success: true, plan: publicManualPlan(plan) };
    });
}
export async function updateStoredManualPlan(userId: string, id: string, patch: UpdateManualPlanInput, expectedVersion: number): Promise<ManualPlanResult<{ plan: ManualPlan }>> {
    return withWatchlistLifecycle(userId, { operation: 'manual-plan-update' }, async () => {
        const found = await findPlan(userId, id);
        if (!found) return missing();
        const current = found.plan;
        if (current.version !== expectedVersion) return conflict();
        const reschedule = patch.checkDate !== undefined && patch.checkDate !== current.checkDate;
        const stateChange = patch.manualState !== undefined && patch.manualState !== current.manualState;
        if (reschedule && !patch.scheduleReason) return failure('INVALID', '修改检查日期时请填写调整原因，原日期与原因会继续保留');
        if (stateChange && patch.manualState !== 'waiting' && !patch.stateReason) return failure('INVALID', '请填写完成依据或取消原因，记录会继续保留');
        if (stateChange && patch.manualState === 'waiting' && await waitingCount(userId) >= MANUAL_PLAN_LIMIT) return capacity();
        const { scheduleReason, ...fields } = patch;
        const now = new Date();
        const revision = current.scheduleRevision ?? 1;
        if (reschedule && revision >= Number.MAX_SAFE_INTEGER - 1) return failure('INVALID', '计划安排版本已达到上限');
        const updates = { ...fields, version: current.version + 1, scheduleRevision: revision + (reschedule ? 1 : 0), updatedAt: now };
        // Include the existing immutable snapshot and reject before either schedule or plan writes.
        if (BSON.calculateObjectSize({ ...current, userId, ...updates }) > 12 * 1024 * 1024) return failure('INVALID', '更新后计划超过备份支持的 12 MiB 单条容量；原文未截断，本次未保存，输入仍保留');
        if (reschedule) await ScheduleModel.create({
            userId, planId: id, revision: revision + 1, fromDate: current.checkDate, toDate: patch.checkDate!, reason: scheduleReason!, changedAt: now,
        });
        let saved: StoredManualPlan;
        if (found.record) {
            const result = await ManualPlanRecord.findOneAndUpdate({ userId, id, version: expectedVersion }, { $set: updates }, { new: true, runValidators: true }).lean();
            if (!result) {
                if (reschedule) throw new Error('Schedule history written but plan CAS failed');
                return conflict();
            }
            saved = result;
        } else {
            // A user edit creates an override; preserve the legacy original, ID and immutable fingerprint.
            const record: StoredManualPlanRecord = {
                userId, ...publicToStored(current), ...updates,
            };
            await ManualPlanRecord.create(record);
            saved = record;
        }
        return { success: true, plan: publicManualPlan(saved) };
    });
}
function publicToStored(plan: StoredManualPlan): StoredManualPlan {
    const { id, symbol, waitingCondition, invalidation, nextAction, checkDate, manualState, version, clientRequestId, createFingerprint, createdAt, updatedAt, stateReason, observationVersionId, observationSnapshot } = plan;
    return { id, symbol, waitingCondition, invalidation, nextAction, checkDate, manualState, version, clientRequestId, createFingerprint, createdAt, updatedAt,
        ...(stateReason ? { stateReason } : {}), ...(observationVersionId ? { observationVersionId } : {}), ...(observationSnapshot ? { observationSnapshot } : {}) };
}
export async function listManualPlanScheduleHistory(userId: string, planId: string, beforeRevision?: number): Promise<ManualPlanResult<{ history: ManualPlanSchedule[]; nextCursor?: number }>> {
    return withWatchlistLifecycle(userId, { operation: 'manual-plan-schedule-history', readOnly: true }, async () => {
        if (!await findPlan(userId, planId)) return missing();
        const rows = await ScheduleModel.find({ userId, planId, ...(beforeRevision ? { revision: { $lt: beforeRevision } } : {}) })
            .sort({ revision: -1 }).limit(MANUAL_PLAN_PAGE_SIZE + 1).lean();
        const history = rows.slice(0, MANUAL_PLAN_PAGE_SIZE).map(({ planId, revision, fromDate, toDate, reason, changedAt }) => ({ planId, revision, fromDate, toDate, reason, changedAt: changedAt.toISOString() }));
        return { success: true, history, ...(rows.length > MANUAL_PLAN_PAGE_SIZE ? { nextCursor: history.at(-1)!.revision } : {}) };
    });
}

/** Bounded due plans use exchange-local dates; maintenance/errors propagate, never masquerade as an empty inbox. */
export async function listDueManualPlans(userId: string, now: Date): Promise<{ plans: ManualPlan[]; truncated: boolean }> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('无效的计划核查时间');
    return withWatchlistLifecycle(userId, { operation: 'manual-plan-due', readOnly: true }, async () => {
        const legacy = await legacyRemainder(userId);
        const latestDay = ['AAPL', '00700.HK', '2330.TW', '600000.SS'].map((symbol) => exchangeDateForSymbol(symbol, now)).sort().at(-1)!;
        const records = await ManualPlanRecord.find({ userId, manualState: 'waiting', checkDate: { $lte: latestDay } })
            .sort({ checkDate: 1, id: 1 }).limit(MANUAL_PLAN_LIMIT + 1).lean();
        const due = [...records, ...legacy].filter((plan) => plan.manualState === 'waiting' && plan.checkDate <= exchangeDateForSymbol(plan.symbol, now))
            .sort((a, b) => a.checkDate.localeCompare(b.checkDate) || a.id.localeCompare(b.id));
        return { plans: due.slice(0, MANUAL_PLAN_LIMIT).map(publicManualPlan), truncated: due.length > MANUAL_PLAN_LIMIT || records.length > MANUAL_PLAN_LIMIT };
    });
}
