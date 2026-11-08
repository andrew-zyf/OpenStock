'use server';

import { connectToDatabase } from '@/database/mongoose';
import { PeerGroupRecord } from '@/database/models/peer-group.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { withWatchlistLifecycle } from '@/lib/watchlist-lifecycle';
import { PeerGroupInputError, canonicalPeerMember, validatePeerGroupInput, PEER_GROUP_LIMIT, type PeerGroup } from '@/lib/market/daily-research';
import type { ComparisonActionResult } from '@/lib/research-comparisons';

async function safePeerGroup<T>(operation: () => Promise<T>): Promise<ComparisonActionResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) { return { ok: false, error: { code: error instanceof PeerGroupInputError ? 'INVALID_GROUP' : 'REQUEST_FAILED',
        message: error instanceof PeerGroupInputError ? error.message : '分组请求未完成，请确认登录与资料维护状态后重试。' } }; }
}

function serialize(row: { _id: unknown; name: string; purpose?: 'peer' | 'theme'; members: { symbolId: string; symbol: string }[]; membershipSavedAt: Date }): PeerGroup {
    return { id: String(row._id), name: row.name, purpose: row.purpose ?? 'peer', members: row.members.map(({ symbolId, symbol }) => ({ symbolId, symbol })), membershipSavedAt: row.membershipSavedAt.toISOString() };
}
function checkId(id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new PeerGroupInputError('同业组编号无效');
}

export async function getPeerGroups(): Promise<PeerGroup[]> {
    const userId = await requireUserId();
    await connectToDatabase();
    const rows = await PeerGroupRecord.find({ userId }).sort({ membershipSavedAt: -1, _id: 1 }).limit(PEER_GROUP_LIMIT).lean();
    return rows.map(serialize);
}

export async function getPeerGroup(id: string): Promise<PeerGroup> {
    const userId = await requireUserId();
    checkId(id);
    await connectToDatabase();
    const row = await PeerGroupRecord.findOne({ _id: id, userId }).lean();
    if (!row) throw new PeerGroupInputError('未找到当前账户的同业组');
    return serialize(row);
}

/** Save an explicit fixed membership snapshot; edits are saved as another group. */
export async function createPeerGroup(input: { name: string; symbolIds: string[]; purpose?: 'peer' | 'theme' }): Promise<PeerGroup> {
    const userId = await requireUserId();
    const value = validatePeerGroupInput(input);
    const watched = await withWatchlistLifecycle(userId, { operation: 'peer-group-membership', readOnly: true }, async () =>
        Watchlist.find({ userId, archivedAt: null }).select({ symbol: 1 }).limit(100).lean());
    const activeIds = new Set(watched.flatMap(row => {
        try { return [canonicalPeerMember(row.symbol).symbolId]; }
        catch { return []; }
    }));
    if (value.members.some(member => !activeIds.has(member.symbolId))) throw new PeerGroupInputError('保存时每个成员都须属于当前账户的关注中自选');
    const membershipSavedAt = new Date();
    for (let slot = 0; slot < PEER_GROUP_LIMIT; slot++) {
        try {
            return serialize(await PeerGroupRecord.create({ userId, slot, ...value, membershipSavedAt }));
        } catch (error) {
            if ((error as { code?: number }).code !== 11000) throw error;
        }
    }
    throw new PeerGroupInputError('最多保存 10 个固定同业组，请先删除不用的组');
}

export async function deletePeerGroup(id: string): Promise<void> {
    const userId = await requireUserId();
    checkId(id);
    await connectToDatabase();
    const result = await PeerGroupRecord.deleteOne({ _id: id, userId });
    if (!result.deletedCount) throw new PeerGroupInputError('未找到当前账户的同业组');
}

// Keep internal throwing APIs compatible; client submission paths receive stable serialized errors.
export async function getPeerGroupsResult(): Promise<ComparisonActionResult<PeerGroup[]>> {
    return safePeerGroup(getPeerGroups);
}
export async function createPeerGroupResult(input: Parameters<typeof createPeerGroup>[0]): Promise<ComparisonActionResult<PeerGroup>> {
    return safePeerGroup(() => createPeerGroup(input));
}
export async function deletePeerGroupResult(id: string): Promise<ComparisonActionResult<null>> {
    return safePeerGroup(async () => { await deletePeerGroup(id); return null; });
}
