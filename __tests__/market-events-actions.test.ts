import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventInput } from '@/lib/market/events';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), watchlist: vi.fn(), find: vi.fn(), findOne: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: mocks.connect }));
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: mocks.auth }));
vi.mock('@/lib/actions/watchlist.actions', () => ({ getUserWatchlist: mocks.watchlist }));
vi.mock('@/database/models/market-event.model', () => ({ MarketEventRecord: { find: mocks.find, findOne: mocks.findOne, create: mocks.create, countDocuments: mocks.count, updateOne: mocks.update } }));
import { cancelMarketEvent, createMarketEvent, getWatchlistEvents } from '@/lib/actions/market-events.actions';

const input: EventInput = { symbol: '2330.TW', date: '2026-11-13', title: '核查公告', kind: 'other', clientRequestId: 'request-123' };
const row = { ...input, _id: 'abcdef012345678901234567', userId: 'user-a', createdAt: new Date('2026-11-08T01:00:00Z') };
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T01:00:00Z'));
    mocks.auth.mockResolvedValue('user-a'); mocks.connect.mockResolvedValue(undefined);
    mocks.watchlist.mockResolvedValue([{ symbol: '2330.TW', company: '台積電' }]);
    mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) });
    mocks.findOne.mockReturnValue({ lean: async () => null }); mocks.count.mockResolvedValue(0);
    mocks.create.mockResolvedValue(row); mocks.update.mockResolvedValue({ matchedCount: 1 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('authenticated event calendar actions', () => {
    it('persists user events without promoting their certainty based on an official URL', async () => {
        const result = await createMarketEvent({ ...input, sourceUrl: 'https://www.twse.com.tw/' });
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', symbol: '2330.TW', sourceUrl: 'https://www.twse.com.tw/' }));
        expect(result.certainty).toBe('user');
        expect(result.createdAt).toBe('2026-11-08T01:00:00.000Z');
    });
    it('requires login and current watchlist membership before writes', async () => {
        mocks.auth.mockRejectedValueOnce(new Error('Unauthorized'));
        await expect(createMarketEvent(input)).rejects.toThrow('Unauthorized');
        expect(mocks.create).not.toHaveBeenCalled();
        mocks.watchlist.mockResolvedValue([]);
        await expect(createMarketEvent(input)).rejects.toThrow('加入当前账户自选');
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('rejects unsafe evidence and invalid dates before any database connection', async () => {
        await expect(createMarketEvent({ ...input, sourceUrl: 'javascript:alert(1)' })).rejects.toThrow();
        await expect(createMarketEvent({ ...input, date: '2026-02-30' })).rejects.toThrow();
        expect(mocks.connect).not.toHaveBeenCalled();
    });
    it('returns an identical retry and rejects a request ID reused for different content', async () => {
        mocks.findOne.mockReturnValue({ lean: async () => row });
        expect((await createMarketEvent(input)).id).toBe(row._id);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.findOne).toHaveBeenCalledWith({ userId: 'user-a', clientRequestId: 'request-123' });
        await expect(createMarketEvent({ ...input, title: '另一事项' })).rejects.toThrow('请求标识已使用');
    });
    it('recovers an identical concurrent insert without creating a second event', async () => {
        mocks.findOne.mockReturnValueOnce({ lean: async () => null }).mockReturnValueOnce({ lean: async () => row });
        mocks.create.mockRejectedValueOnce({ code: 11000 });
        expect((await createMarketEvent(input)).id).toBe(row._id);
        expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    it('rejects cancelled request IDs even when recovering an insert race', async () => {
        mocks.findOne.mockReturnValue({ lean: async () => ({ ...row, cancelledAt: new Date() }) });
        await expect(createMarketEvent(input)).rejects.toThrow('请求标识已使用');
        mocks.findOne.mockReturnValueOnce({ lean: async () => null }).mockReturnValueOnce({ lean: async () => ({ ...row, cancelledAt: new Date() }) });
        mocks.create.mockRejectedValueOnce({ code: 11000 });
        await expect(createMarketEvent(input)).rejects.toThrow('提交冲突');
    });
    it('normalizes aliases and never persists client-supplied ownership or certainty', async () => {
        mocks.watchlist.mockResolvedValue([{ symbol: 'HKEX:700' }]);
        await createMarketEvent({ ...input, symbol: '0700.HK', userId: 'other-user', certainty: 'official-schedule' } as EventInput);
        expect(mocks.create).toHaveBeenCalledWith({ ...input, symbol: '00700.HK', userId: 'user-a', sourceUrl: undefined, note: undefined });
    });
    it('does not read records or fetch sources for an unauthenticated calendar request', async () => {
        mocks.auth.mockRejectedValueOnce(new Error('Unauthorized'));
        vi.stubGlobal('fetch', vi.fn());
        await expect(getWatchlistEvents()).rejects.toThrow('Unauthorized');
        expect(mocks.find).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
    it('isolates source failures between markets', async () => {
        mocks.watchlist.mockResolvedValue([{ symbol: '2330.TW' }, { symbol: '600519.SS' }]);
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.includes('twse.com.tw')) throw new Error('TW source unavailable');
            return { ok: true, json: async () => ({ success: true, result: { data: [{ SECUCODE: '600519.SH', REPORT_DATE: '2026-09-30', APPOINT_PUBLISH_DATE: '2026-11-10 00:00:00', IS_PUBLISH: '0' }] } }) };
        }));
        const result = await getWatchlistEvents();
        expect(result.events).toHaveLength(1); expect(result.events[0].certainty).toBe('estimated');
        expect(result.sources.map((source) => source.status).sort()).toEqual(['error', 'ready']);
    });
    it('enforces a bounded active record count', async () => {
        mocks.count.mockResolvedValue(100);
        await expect(createMarketEvent(input)).rejects.toThrow('100');
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('only cancels the current owner record, retaining the stored event', async () => {
        await cancelMarketEvent(row._id);
        expect(mocks.update).toHaveBeenCalledWith({ _id: row._id, userId: 'user-a', cancelledAt: { $exists: false } }, { $set: { cancelledAt: new Date() } });
        mocks.update.mockResolvedValue({ matchedCount: 0 });
        await expect(cancelMarketEvent(row._id)).rejects.toThrow('未找到');
    });
    it('merges official TWSE schedules with user records and discloses uncovered markets', async () => {
        mocks.watchlist.mockResolvedValue([{ symbol: '2330.TW' }, { symbol: 'AAPL' }]);
        mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) });
        const fetcher = vi.fn(async () => ({ ok: true, json: async () => [{ Date: '1151112', Code: '2330', Name: '台積電', Exdividend: '息' }] }));
        vi.stubGlobal('fetch', fetcher);
        const result = await getWatchlistEvents();
        expect(result.events.map((event) => event.certainty)).toEqual(['official-schedule', 'user']);
        expect(result.sources.some((source) => source.status === 'unsupported')).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(mocks.find).toHaveBeenCalledWith({ userId: 'user-a', cancelledAt: { $exists: false } });
    });
    it('retains user events for removed symbols so they remain cancellable', async () => {
        mocks.watchlist.mockResolvedValue([]);
        mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) });
        vi.stubGlobal('fetch', vi.fn());
        const result = await getWatchlistEvents();
        expect(result.events).toHaveLength(1);
        expect(fetch).not.toHaveBeenCalled();
    });
    it('distinguishes failed sources from the live-verified empty disclosure payload', async () => {
        mocks.watchlist.mockResolvedValue([{ symbol: '600519.SS' }]);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ code: 9201, success: false, result: null }) })));
        expect((await getWatchlistEvents()).sources[0].status).toBe('ready');
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
        expect((await getWatchlistEvents()).sources[0].status).toBe('error');
    });
    it('isolates an upstream timeout and preserves manually entered events', async () => {
        mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) });
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        const promise = getWatchlistEvents();
        await vi.advanceTimersByTimeAsync(6_001);
        const result = await promise;
        expect(result.events).toHaveLength(1);
        expect(result.sources[0].status).toBe('error');
    });
});
