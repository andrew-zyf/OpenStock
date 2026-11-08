'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist, WatchlistLifecycle } from '@/database/models/watchlist.model';
import { ManualPlanBook } from '@/database/models/manual-plan.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { WatchlistLifecycleError, withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';

export type ResearchCapacityDocument = {
    kind: 'research' | 'manual-plans';
    id: string;
    symbol: string | null;
    bytes: number;
    entries: number | null;
};
export type ResearchMaintenanceStatus = {
    state: 'idle' | 'busy' | 'maintenance' | 'unknown';
    operationLabel: string | null;
    startedAt: string | null;
    checkedAt: string;
    capability: { transactions: boolean | null };
    capacity: { state: 'ready' | 'skipped' | 'unknown'; documents: ResearchCapacityDocument[]; truncated: boolean };
};

const READ_TIMEOUT_MS = 1500;
const DOCUMENT_LIMIT = 50;
const OPERATION_LABELS: Record<string, string> = {
    add: '添加关注', archive: '归档研究', restore: '恢复关注', observation: '保存观察', review: '追加复核',
    'read-active': '读取关注研究', 'read-archived': '读取归档研究', 'read-membership': '读取关注身份',
    'research-changes-journal': '读取研究变化', 'research-backup-export': '导出研究备份',
    'research-backup-preview': '预览研究导入', 'research-backup-import': '导入研究备份',
    'research-capacity-read': '读取研究容量',
    'manual-plan-list': '读取人工计划列表', 'manual-plan-read': '读取人工计划',
    'manual-plan-create': '新建人工计划', 'manual-plan-update': '修改人工计划',
    'manual-plan-schedule-history': '读取计划日期调整记录', 'manual-plan-due': '读取到期人工计划',
};

// Only race read operations. Never abandon a lifecycle holder whose release is still pending.
async function boundedRead<T>(read: PromiseLike<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([read, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Status read timed out')), READ_TIMEOUT_MS);
        })]);
    } finally { clearTimeout(timer); }
}

async function coordination(userId: string): Promise<Pick<ResearchMaintenanceStatus, 'state' | 'operationLabel' | 'startedAt'>> {
    // Compute presence on the server: neither lockToken nor a raw intent/symbol leaves this read.
    const [row] = await boundedRead(WatchlistLifecycle.aggregate([
        { $match: { _id: userId } }, { $limit: 1 },
        { $project: { _id: 0, hasLock: { $ne: [{ $ifNull: ['$lockToken', null] }, null] }, maintenanceRequired: 1, operation: 1, acquiredAt: 1 } },
    ]).option({ maxTimeMS: READ_TIMEOUT_MS, timeoutMS: READ_TIMEOUT_MS }).exec());
    if (!row) return { state: 'idle', operationLabel: null, startedAt: null };
    const state = row.maintenanceRequired === true ? 'maintenance'
        : row.maintenanceRequired != null && row.maintenanceRequired !== false ? 'unknown'
            : row.hasLock === true ? 'busy' : row.hasLock === false ? 'idle' : 'unknown';
    if (state === 'idle') return { state, operationLabel: null, startedAt: null };
    const date = row.acquiredAt instanceof Date ? row.acquiredAt
        : typeof row.acquiredAt === 'string' ? new Date(row.acquiredAt) : null;
    const iso = date && Number.isFinite(date.getTime()) && date.getTime() >= 0 ? date.toISOString() : null;
    return {
        state,
        operationLabel: typeof row.operation === 'string' && Object.hasOwn(OPERATION_LABELS, row.operation)
            ? OPERATION_LABELS[row.operation] : '其他研究操作',
        startedAt: typeof row.acquiredAt === 'string' && row.acquiredAt !== iso ? null : iso,
    };
}

async function capacityDocuments(userId: string): Promise<ResearchMaintenanceStatus['capacity']> {
    // Limit BEFORE BSON/array work; only small metadata crosses the wire, never journal contents.
    const research = await Watchlist.aggregate([
        { $match: { userId } }, { $limit: DOCUMENT_LIMIT + 1 },
        { $project: { _id: { $toString: '$_id' }, symbol: 1, bytes: { $bsonSize: '$$ROOT' },
            entries: { $cond: [{ $isArray: '$journal' }, { $size: '$journal' }, null] } } },
    ]).option({ maxTimeMS: READ_TIMEOUT_MS, timeoutMS: READ_TIMEOUT_MS }).exec();
    // The untouched legacy book only: independent plan records and schedule history are not sampled.
    const plans = await ManualPlanBook.aggregate([
        { $match: { userId } }, { $limit: 1 },
        { $project: { _id: { $toString: '$_id' }, bytes: { $bsonSize: '$$ROOT' },
            entries: { $cond: [{ $isArray: '$plans' }, { $size: '$plans' }, null] } } },
    ]).option({ maxTimeMS: READ_TIMEOUT_MS, timeoutMS: READ_TIMEOUT_MS }).exec();
    const documents: ResearchCapacityDocument[] = [];
    for (const [kind, rows] of [['research', research.slice(0, DOCUMENT_LIMIT)], ['manual-plans', plans]] as const) {
        for (const row of rows) {
            if (typeof row._id !== 'string' || !/^[a-f\d]{24}$/i.test(row._id)
                || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw new Error('Invalid capacity metadata');
            documents.push({
                kind, id: row._id,
                symbol: kind === 'research' && typeof row.symbol === 'string' && /^[A-Z0-9^][A-Z0-9.^:&-]{0,29}$/i.test(row.symbol) ? row.symbol : null,
                bytes: row.bytes,
                entries: Number.isSafeInteger(row.entries) && row.entries >= 0 ? row.entries : null,
            });
        }
    }
    return { state: 'ready', documents, truncated: research.length > DOCUMENT_LIMIT };
}

/** Owner-only diagnostic read; does not attempt to acquire an already blocked lifecycle lock. */
export async function getResearchMaintenanceStatus(): Promise<ResearchMaintenanceStatus> {
    const userId = await requireUserId();
    const result: ResearchMaintenanceStatus = {
        state: 'unknown', operationLabel: null, startedAt: null, checkedAt: new Date().toISOString(),
        capability: { transactions: null }, capacity: { state: 'skipped', documents: [], truncated: false },
    };
    let database: Awaited<ReturnType<typeof connectToDatabase>>;
    try { database = await boundedRead(connectToDatabase()); }
    catch { return result; }

    // Topology evidence only, not a successful import rehearsal or permission/configuration probe.
    const capability = (async () => {
        try {
            const db = database.connection.db;
            if (!db) return;
            const hello = await boundedRead(db.admin().command({ hello: 1 }, { timeoutMS: READ_TIMEOUT_MS }));
            if (hello.ok !== 1 || typeof hello.maxWireVersion !== 'number'
                || !Number.isFinite(hello.maxWireVersion)) return;
            const sessions = typeof hello.logicalSessionTimeoutMinutes === 'number'
                && Number.isFinite(hello.logicalSessionTimeoutMinutes) && hello.logicalSessionTimeoutMinutes > 0;
            const replica = typeof hello.setName === 'string' && hello.setName.length > 0;
            const router = hello.msg === 'isdbgrid';
            result.capability.transactions = sessions && ((replica && hello.maxWireVersion >= 7) || (router && hello.maxWireVersion >= 8));
        } catch { /* Unknown is distinct from unsupported. Never return the driver error. */ }
    })();
    try {
        Object.assign(result, await coordination(userId));
        if (result.state === 'idle') {
            try {
                result.capacity = await withWatchlistLifecycle(userId, { operation: 'research-capacity-read', readOnly: true }, () => capacityDocuments(userId));
            } catch (error) {
                result.capacity = { state: 'unknown', documents: [], truncated: false };
                // Another holder may win between the status read and capacity acquisition.
                try { Object.assign(result, await coordination(userId)); }
                catch { result.state = 'unknown'; result.operationLabel = null; result.startedAt = null; }
                if (error instanceof WatchlistLifecycleError && result.state === 'idle') {
                    result.state = error.code === 'LIFECYCLE_MAINTENANCE' ? 'maintenance' : 'busy';
                }
            }
        }
    } catch { /* Fail closed without exposing raw database messages. */ }
    await capability;
    return result;
}
