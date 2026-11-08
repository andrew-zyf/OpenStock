import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), find: vi.fn(), findOne: vi.fn(), create: vi.fn(), remove: vi.fn(), watchlist: vi.fn(), lifecycle: vi.fn(), locked: false }));
vi.mock('@/lib/watchlist-lifecycle', () => ({ withWatchlistLifecycle: mocks.lifecycle }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/database/models/watchlist.model', () => ({ Watchlist: { find: mocks.watchlist } }));
vi.mock('@/database/models/peer-group.model', () => ({ PeerGroupRecord: { find: mocks.find, findOne: mocks.findOne, create: mocks.create, deleteOne: mocks.remove } }));
import { createPeerGroup, deletePeerGroup, getPeerGroup, getPeerGroups } from '@/lib/actions/peer-groups.actions';
const id = 'abcdef012345678901234567';
const row = { _id: id, userId: 'owner-a', name: '同业', members: [{ symbol: '00700.HK', symbolId: 'HKEX:00700.HK' }], membershipSavedAt: new Date('2026-11-08T00:00:00Z') };
beforeEach(() => {
    vi.clearAllMocks(); mocks.auth.mockResolvedValue('owner-a'); mocks.connect.mockResolvedValue(undefined);
    mocks.locked = false;
    mocks.lifecycle.mockImplementation(async (_userId: string, _intent: unknown, callback: () => Promise<unknown>) => {
        mocks.locked = true;
        try { return await callback(); } finally { mocks.locked = false; }
    });
    mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) });
    mocks.findOne.mockReturnValue({ lean: async () => row });
    mocks.watchlist.mockReturnValue({ select: () => ({ limit: () => ({ lean: async () => [{ symbol: '700.HK' }, { symbol: 'BINANCE:BTCUSDT' }] }) }) });
    mocks.create.mockResolvedValue(row); mocks.remove.mockResolvedValue({ deletedCount: 1 });
});

describe('fixed peer group ownership and caps', () => {
    it('requires authentication for every read and mutation before queries', async () => {
        mocks.auth.mockRejectedValue(new Error('Unauthorized'));
        await expect(getPeerGroups()).rejects.toThrow('Unauthorized');
        await expect(getPeerGroup(id)).rejects.toThrow('Unauthorized');
        await expect(createPeerGroup({ name: '同业', symbolIds: ['700.HK'] })).rejects.toThrow('Unauthorized');
        await expect(deletePeerGroup(id)).rejects.toThrow('Unauthorized');
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('scopes list/get/delete to authenticated ownership and rejects foreign groups', async () => {
        expect(await getPeerGroups()).toEqual([{ id, name: '同业', members: row.members, membershipSavedAt: '2026-11-08T00:00:00.000Z' }]);
        expect(mocks.find).toHaveBeenCalledWith({ userId: 'owner-a' });
        await getPeerGroup(id); expect(mocks.findOne).toHaveBeenCalledWith({ _id: id, userId: 'owner-a' });
        mocks.findOne.mockReturnValue({ lean: async () => null });
        await expect(getPeerGroup(id)).rejects.toThrow('当前账户');
        await deletePeerGroup(id); expect(mocks.remove).toHaveBeenCalledWith({ _id: id, userId: 'owner-a' });
        mocks.remove.mockResolvedValue({ deletedCount: 0 });
        await expect(deletePeerGroup(id)).rejects.toThrow('当前账户');
    });
    it('locks only the raw active membership read and saves the fixed group after releasing it', async () => {
        mocks.watchlist.mockImplementationOnce(() => {
            expect(mocks.locked).toBe(true);
            return { select: () => ({ limit: () => ({ lean: async () => [{ symbol: '700.HK' }] }) }) };
        });
        mocks.create.mockImplementationOnce(async () => { expect(mocks.locked).toBe(false); return row; });
        await createPeerGroup({ name: '同业', symbolIds: ['700.HK'] });
        expect(mocks.lifecycle).toHaveBeenCalledWith('owner-a', { operation: 'peer-group-membership', readOnly: true }, expect.any(Function));
        expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
    });
    it('does not read partial membership or save groups when the lifecycle lock is unavailable', async () => {
        mocks.lifecycle.mockRejectedValueOnce(new Error('LIFECYCLE_BUSY'));
        await expect(createPeerGroup({ name: '同业', symbolIds: ['700.HK'] })).rejects.toThrow('LIFECYCLE_BUSY');
        expect(mocks.watchlist).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    });
    it('canonicalizes immutable membership and only accepts active own members; ignores forged owner/date', async () => {
        await createPeerGroup({ name: ' 同业 ', symbolIds: ['700.HK', 'HKEX:00700.HK'], userId: 'other', membershipSavedAt: '2000-01-01' } as Parameters<typeof createPeerGroup>[0]);
        expect(mocks.watchlist).toHaveBeenCalledWith({ userId: 'owner-a', archivedAt: null });
        expect(mocks.create).toHaveBeenCalledWith({ userId: 'owner-a', slot: 0, name: '同业', members: row.members, membershipSavedAt: expect.any(Date) });
        await expect(createPeerGroup({ name: '另一组', symbolIds: ['AAPL'] })).rejects.toThrow('关注中自选');
        expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    it('bounds concurrent saves by unique owner slots rather than a racy count-then-insert', async () => {
        mocks.create.mockRejectedValueOnce({ code: 11000 }).mockResolvedValueOnce(row);
        await createPeerGroup({ name: '同业', symbolIds: ['700.HK'] });
        expect(mocks.create.mock.calls.map(([input]) => input.slot)).toEqual([0, 1]);
        mocks.create.mockClear().mockRejectedValue({ code: 11000 });
        await expect(createPeerGroup({ name: '同业', symbolIds: ['700.HK'] })).rejects.toThrow('最多保存 10');
        expect(mocks.create).toHaveBeenCalledTimes(10);
    });
    it('does not retry unrelated database failures, and rejects malformed IDs before connecting', async () => {
        mocks.create.mockRejectedValueOnce(new Error('database down'));
        await expect(createPeerGroup({ name: '同业', symbolIds: ['700.HK'] })).rejects.toThrow('database down');
        expect(mocks.create).toHaveBeenCalledTimes(1);
        mocks.connect.mockClear(); await expect(getPeerGroup('$ne')).rejects.toThrow('编号');
        await expect(deletePeerGroup('$ne')).rejects.toThrow('编号');
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});
