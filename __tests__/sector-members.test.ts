import { afterEach, describe, expect, it, vi } from 'vitest';
import { getChinaSectorMembers } from '@/lib/actions/sector-members.actions';
import { canonicalCNsymbol, parseChinaSectorMembers, sectorMembersPage, summarizeSectorMembers } from '@/lib/market/sector-members';

const timestamp = Date.parse('2026-11-06T07:00:00Z') / 1000;
const row = (code = '600000', change: unknown = 0) => ({ f12: code, f13: code.startsWith('6') ? 1 : 0, f14: `证券${code}`, f2: 10, f3: change, f124: timestamp });
const response = (rows: unknown[], total: unknown = rows.length) => Response.json({ rc: 0, data: { diff: rows, total } });
const hundred = (offset = 0) => Array.from({ length: 100 }, (_, index) => row(String(600000 + offset + index), index - 50));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('China sector member identities and source values', () => {
    it('canonicalizes Chinese aliases while refusing foreign symbols and arbitrary paths', () => {
        expect(canonicalCNsymbol(' sse:600000 ')).toBe('600000.SS');
        expect(canonicalCNsymbol('600000.sh')).toBe('600000.SS');
        expect(canonicalCNsymbol('000001')).toBe('000001.SZ');
        expect(canonicalCNsymbol('920181')).toBe('920181.BJ');
        for (const symbol of ['00700.HK', '2330.TW', 'AAPL', 'BK1036', '../600000', 'HKEX:600000']) expect(canonicalCNsymbol(symbol)).toBeUndefined();
    });
    it('retains signed and zero changes, missing prices, and the true BSE exchange', () => {
        const members = parseChinaSectorMembers([row(), row('000001', -2.5), row('920181', 1), { ...row('600001'), f2: 0 },
            { ...row('600002'), f2: '-' }, { ...row('600003'), f3: '' }, row(), { ...row('600004'), f13: 128 },
            { ...row('00700'), f13: 116 }, row('AAPL')]);
        expect(members).toHaveLength(6);
        expect(members.find((member) => member.symbol === '600000.SS')).toMatchObject({ changePercent: 0, price: 10, date: '2026-11-06', asOf: '2026-11-06T07:00:00.000Z' });
        expect(members.find((member) => member.symbol === '000001.SZ')?.changePercent).toBe(-2.5);
        expect(members.find((member) => member.symbol === '920181.BJ')?.changePercent).toBe(1);
        expect(members.find((member) => member.symbol === '600001.SS')).toMatchObject({ price: 0 });
        for (const code of ['600001', '600002', '600003']) expect(members.find((member) => member.symbol === `${code}.SS`)?.changePercent).toBeUndefined();
    });
    it('only counts the latest source date, never backfills a source timestamp, and computes an equal-weight mean', () => {
        const members = parseChinaSectorMembers([row('600000', 0), row('600001', 4), row('600002', -2),
            { ...row('600003', 9), f124: timestamp - 86400 }, { ...row('600004', 10), f124: '-' }, { ...row('600005'), f3: '-' }]);
        const summary = summarizeSectorMembers(members);
        expect(summary.breadth).toEqual({ up: 1, down: 1, flat: 1, missing: 3 });
        expect(summary.averageChangePercent).toBeCloseTo(2 / 3);
        expect(summary.members.find((member) => member.symbol === '600003.SS')?.changePercent).toBeUndefined();
        expect(summary.members.find((member) => member.symbol === '600004.SS')?.asOf).toBeUndefined();
        const unknown = summarizeSectorMembers(parseChinaSectorMembers([{ ...row(), f124: null }]));
        expect(unknown).toMatchObject({ breadth: { up: 0, down: 0, flat: 0, missing: 1 } });
        expect(unknown.date).toBeUndefined();
        expect(unknown.asOf).toBeUndefined();
        expect(unknown.averageChangePercent).toBeUndefined();
    });
    it('uses the source date in Shanghai even near the UTC date boundary', () => {
        const [member] = parseChinaSectorMembers([{ ...row(), f124: Date.parse('2026-11-05T23:30:00Z') / 1000 }]);
        expect(member.date).toBe('2026-11-06');
    });
    it('rejects malformed and oversized page responses rather than pretending they are empty', () => {
        for (const value of [{}, { data: null }, { data: { diff: {} } }, { data: { diff: [null] } },
            { data: { diff: [...hundred(), row()] } }, { rc: 1, data: { diff: [] } }]) expect(() => sectorMembersPage(value)).toThrow();
        expect(sectorMembersPage({ data: { diff: [], total: 0 } })).toEqual({ rows: [], total: 0 });
    });
});

describe('bounded on-demand sector member server action', () => {
    it.each(['BK103', 'BK10360', 'bk1036', 'BK1036&fs=m:116', 'https://example.com', '', null, 123])('rejects unsupported identifiers %s before any HTTP', async (code) => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        const result = await getChinaSectorMembers(code as string);
        expect(result.status).toBe('unsupported');
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('rejects non-China market scope before any HTTP', async () => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        expect((await getChinaSectorMembers('BK1036', 'hk')).status).toBe('unsupported');
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('requests actual fixed-source members with code order, pz100 and cache300, not sector leaders', async () => {
        const fetcher = vi.fn(async () => response([row('600000', 0), row('920181', 1)]));
        vi.stubGlobal('fetch', fetcher);
        const result = await getChinaSectorMembers('BK1036');
        const [input, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit & { next: { revalidate: number } }];
        const url = new URL(input);
        expect(url.origin + url.pathname).toBe('https://push2.eastmoney.com/api/qt/clist/get');
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ pn: '1', pz: '100', fid: 'f12', po: '0', fs: 'b:BK1036', fields: 'f12,f13,f14,f2,f3,f124' });
        expect(options.next.revalidate).toBe(300);
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: 'ready', total: 2, received: 2, pages: 1, date: '2026-11-06', breadth: { flat: 1, up: 1 } });
        expect(result.fetchedAt).not.toBe(result.asOf);
        expect(result.notes.join(' ')).toContain('北交所');
    });
    it('fetches the real second page of a 188-member industry', async () => {
        const fetcher = vi.fn(async (input: string) => response(new URL(input).searchParams.get('pn') === '1' ? hundred() : hundred(100).slice(0, 88), 188));
        vi.stubGlobal('fetch', fetcher);
        const result = await getChinaSectorMembers('BK1036');
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ status: 'ready', total: 188, received: 188, pages: 2 });
        expect(result.members).toHaveLength(188);
    });
    it('caps requests at three pages and concurrent pages at two, clearly declaring larger-universe samples', async () => {
        let active = 0; let maximum = 0;
        const fetcher = vi.fn(async (input: string) => {
            active++; maximum = Math.max(maximum, active);
            await Promise.resolve(); active--;
            const page = Number(new URL(input).searchParams.get('pn'));
            return response(hundred((page - 1) * 100), 1000);
        });
        vi.stubGlobal('fetch', fetcher);
        const result = await getChinaSectorMembers('BK1036');
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(maximum).toBe(2);
        expect(result).toMatchObject({ status: 'partial', total: 1000, received: 300, pages: 3 });
        expect(result.coverage).toContain('不代表全行业');
        expect(result.members).toHaveLength(300);
    });
    it('retains successful pages on later page failure and does not claim full coverage', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: string) => {
            const page = Number(new URL(input).searchParams.get('pn'));
            if (page === 2) throw new Error('source unavailable');
            return response(hundred((page - 1) * 100), 250);
        }));
        const result = await getChinaSectorMembers('BK1036');
        expect(result).toMatchObject({ status: 'partial', failedPages: 1, received: 200, pages: 2 });
        expect(result.notes.join(' ')).toContain('1 页请求失败');
    });
    it('deduplicates repeated pages and flags changing totals, filtered securities and unknown totals as samples', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: string) => response(hundred(), new URL(input).searchParams.get('pn') === '1' ? 150 : 151)));
        const repeated = await getChinaSectorMembers('BK1036');
        expect(repeated).toMatchObject({ status: 'partial', received: 200 });
        expect(repeated.members).toHaveLength(100);
        expect(repeated.notes.join(' ')).toContain('总数发生变化');
        vi.stubGlobal('fetch', vi.fn(async () => response([row(), row('AAPL')], 2)));
        expect((await getChinaSectorMembers('BK1036')).status).toBe('partial');
        vi.stubGlobal('fetch', vi.fn(async () => response([row()], null)));
        const unknown = await getChinaSectorMembers('BK1036');
        expect(unknown.status).toBe('partial');
        expect(unknown.total).toBeUndefined();
    });
    it('distinguishes valid empty, malformed data, HTTP error, and all-missing source timestamps', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response([], 0)));
        expect((await getChinaSectorMembers('BK1036')).status).toBe('empty');
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: null })));
        expect((await getChinaSectorMembers('BK1036')).status).toBe('error');
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
        expect((await getChinaSectorMembers('BK1036')).status).toBe('error');
        vi.stubGlobal('fetch', vi.fn(async () => response([{ ...row(), f124: '-' }])));
        const unknown = await getChinaSectorMembers('BK1036');
        expect(unknown).toMatchObject({ status: 'partial', breadth: { missing: 1, flat: 0 } });
        expect(unknown.asOf).toBeUndefined();
    });
    it('enforces its six-second deadline even if fetch ignores abort', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetcher);
        const promise = getChinaSectorMembers('BK1036');
        await vi.advanceTimersByTimeAsync(6000);
        expect((await promise).status).toBe('error');
        const options = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
        expect(options?.signal?.aborted).toBe(true);
    });
});
