import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connectToDatabase } from '@/database/mongoose';
import { WatchlistLifecycle } from '@/database/models/watchlist.model';

export class WatchlistLifecycleError extends Error {
    constructor(public readonly code: 'LIFECYCLE_BUSY' | 'LIFECYCLE_MAINTENANCE') {
        super(code === 'LIFECYCLE_BUSY'
            ? '研究记录正在处理其他请求，请稍后重试'
            : '研究记录的协调状态需要管理员检查；本次结果需核查，请勿自动重试或解锁');
    }

    get retryable() { return this.code === 'LIFECYCLE_BUSY'; }

    failure() {
        return { success: false, code: this.code, error: this.message, retryable: this.retryable } as const;
    }
}

export type LifecycleFailure = ReturnType<WatchlistLifecycleError['failure']>;

type LifecycleIntent = { operation: string; symbol?: string; readOnly?: boolean };

/**
 * Standalone-safe, cross-process user mutex. Never expire or steal a token: a paused writer
 * could otherwise resume and corrupt a newer alias transition. A crashed holder stays locked.
 * Recovery is deliberate: stop the holder, inspect operation/symbol and all saved aliases,
 * finish or repair that operation, then clear lockToken/intent/maintenance fields by token.
 * Callers must not nest this helper or call another action which already acquires this lock.
 */
export async function withWatchlistLifecycle<T>(userId: string, intent: LifecycleIntent, operation: () => Promise<T>): Promise<T> {
    await connectToDatabase();
    try {
        await WatchlistLifecycle.updateOne({ _id: userId }, { $setOnInsert: { _id: userId } }, { upsert: true });
    } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
    }
    const token = randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt < 40; attempt++) {
        const lock = await WatchlistLifecycle.findOneAndUpdate(
            { _id: userId, lockToken: null, maintenanceRequired: { $ne: true } },
            { $set: { lockToken: token, operation: intent.operation, symbol: intent.symbol ?? null, acquiredAt: new Date() } },
            { new: true },
        );
        if (lock) { acquired = true; break; }
        const held = await WatchlistLifecycle.findById(userId);
        if (held?.maintenanceRequired) throw new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE');
        if (attempt < 39) await delay(25);
    }
    if (!acquired) throw new WatchlistLifecycleError('LIFECYCLE_BUSY');

    const release = () => WatchlistLifecycle.updateOne({ _id: userId, lockToken: token }, {
        $unset: { lockToken: '', operation: '', symbol: '', acquiredAt: '', maintenanceRequired: '' },
    });
    let result: T;
    try {
        result = await operation();
    } catch (error) {
        if (intent.readOnly) {
            await release();
            throw error;
        }
        // A multi-document write may have applied only part of its intent. Keep it inaccessible
        // rather than publishing partial aliases or retrying a write with an unknown outcome.
        await WatchlistLifecycle.updateOne({ _id: userId, lockToken: token }, { $set: { maintenanceRequired: true } });
        throw new WatchlistLifecycleError('LIFECYCLE_MAINTENANCE');
    }
    await release();
    return result;
}
