import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChinaSectorRankings } from '@/lib/actions/china-market.actions';

const sector = { f12: 'BK001', f14: '半导体', f3: 0, f62: -100, f184: 0, f128: '示例公司', f140: '600000', f141: 1, f136: 0 };
const response = (diff: unknown) => Response.json({ data: { diff } });

afterEach(() => vi.unstubAllGlobals());

describe('sector ranking source isolation', () => {
    it('retains valid inflows when the gainers request fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.includes('fid=f3&')) throw new Error('network unavailable');
            return response([sector]);
        }));
        const result = await getChinaSectorRankings();
        expect(result.topGainers).toEqual([]);
        expect(result.errors?.topGainers).toBeTruthy();
        expect(result.topInflows[0].name).toBe('半导体');
        expect(result.errors?.topInflows).toBeUndefined();
    });

    it('preserves signed amounts and genuine zero percentages', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response([sector])));
        const result = await getChinaSectorRankings();
        expect(result.topGainers[0]).toMatchObject({ changePercent: 0, mainNetInflow: -100, mainNetRatio: 0, leaderChangePercent: 0, leaderSymbol: '600000.SS' });
    });

    it('does not manufacture missing metrics or a leading stock', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response([{ f12: 'BK001', f14: '半导体', f3: '-', f62: '', f184: null }])));
        const result = await getChinaSectorRankings();
        expect(result.topGainers[0]).toMatchObject({ leaderSymbol: '' });
        expect(result.topGainers[0].changePercent).toBeUndefined();
        expect(result.topGainers[0].mainNetInflow).toBeUndefined();
        expect(result.topGainers[0].mainNetRatio).toBeUndefined();
    });

    it('distinguishes an empty valid ranking from a malformed response', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('fid=f3&') ? response([]) : Response.json({ error: 'maintenance' })));
        const result = await getChinaSectorRankings();
        expect(result.topGainers).toEqual([]);
        expect(result.errors?.topGainers).toBeUndefined();
        expect(result.errors?.topInflows).toBeTruthy();
    });
});
