import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchQuoteBatches } from '@/hooks/useLiveQuotes';

afterEach(() => vi.unstubAllGlobals());

function requestedSymbols(url: string) {
    return new URL(url, 'https://example.test').searchParams.get('symbols')!.split(',');
}

describe('watchlist and benchmark quote batching', () => {
    it('deduplicates and requests at most 25 symbols with at most two requests in flight', async () => {
        const symbols = Array.from({ length: 57 }, (_, index) => `S${index}`);
        const batches: string[][] = [];
        const releases: (() => void)[] = [];
        let active = 0;
        let maxActive = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            const batch = requestedSymbols(url);
            batches.push(batch);
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((resolve) => releases.push(resolve));
            active--;
            return { ok: true, json: async () => Object.fromEntries(batch.map((symbol) => [symbol, { c: 20, source: 'test' }])) };
        }));
        const result = fetchQuoteBatches([...symbols, 'S0', 'S56']);
        expect(batches).toHaveLength(2);
        releases[0]();
        await vi.waitFor(() => expect(batches).toHaveLength(3));
        releases[1]();
        releases[2]();
        const quotes = await result;
        expect(maxActive).toBe(2);
        expect(batches.map((batch) => batch.length)).toEqual([25, 25, 7]);
        expect(batches.flat()).toEqual(symbols);
        expect(Object.keys(quotes)).toEqual(symbols);
        expect(quotes.S56).toEqual({ c: 20, source: 'test', stale: false });
    });

    it('retains failed batches and null symbols with original timestamps while successful symbols update', async () => {
        const symbols = Array.from({ length: 52 }, (_, index) => `S${index}`);
        const old = { c: 10, source: 'original', asOf: '2026-11-06T07:00:00Z', fetchedAt: '2026-11-06T07:01:00Z' };
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            const batch = requestedSymbols(url);
            if (batch.includes('S25')) return { ok: false, status: 503 };
            if (batch.includes('S50')) throw new Error('offline');
            return { ok: true, json: async () => Object.fromEntries(batch.map((symbol) => [symbol, symbol === 'S1' ? null : { c: 30, asOf: '2026-11-08T07:00:00Z' }])) };
        }));
        const quotes = await fetchQuoteBatches(symbols, { S1: old, S25: old, S50: old, UNRELATED: old });
        expect(quotes.S0).toEqual({ c: 30, asOf: '2026-11-08T07:00:00Z', stale: false });
        for (const symbol of ['S1', 'S25', 'S50']) expect(quotes[symbol]).toEqual({ ...old, stale: true });
        expect(quotes.S26).toBeNull();
        expect(quotes).not.toHaveProperty('UNRELATED');
    });

    it('rejects a total outage so the resource retains its last successful state', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ A: null }) })));
        await expect(fetchQuoteBatches(['A'], { A: { c: 10 } })).rejects.toThrow('行情暂不可用');
    });
});
