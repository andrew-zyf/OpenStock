import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeQuoteSnapshot } from '@/hooks/useLiveQuotes';
import { QUOTE_REFRESH_MS, startMarketRefresh, type RefreshHost } from '@/lib/market/refresh';

function environment() {
    let visible = true;
    const listeners = new Set<() => void>();
    const host: RefreshHost = {
        now: Date.now, visible: () => visible, setTimeout, clearTimeout,
        subscribe: (callback) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    };
    return { host, listeners, visibility: (value: boolean) => { visible = value; listeners.forEach((fn) => fn()); } };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
afterEach(() => { vi.useRealTimers(); });

it('retains failed symbols with their original source timestamps while healthy quotes update', () => {
    const old = { c: 10, source: 'Tencent', t: 111, asOf: '2026-11-06T07:00:00Z', fetchedAt: '2026-11-08T00:00:00Z' };
    const healthy = { c: 20, source: 'TWSE', t: 222 };
    const merged = mergeQuoteSnapshot(['A', 'B', 'C'], { A: null, B: healthy, C: null }, { A: old, B: { c: 15 }, UNRELATED: { c: 99 } });
    expect(merged.A).toEqual({ ...old, stale: true });
    expect(merged.B).toEqual({ ...healthy, stale: false });
    expect(merged.C).toBeNull();
    expect(merged).not.toHaveProperty('UNRELATED');
    expect(mergeQuoteSnapshot(['A'], { A: { c: 30, t: 333 } }, merged).A).toEqual({ c: 30, t: 333, stale: false });
});

it('invokes native-style timer functions without a foreign host receiver', async () => {
    vi.useFakeTimers();
    const env = environment();
    const onData = vi.fn();
    env.host.setTimeout = function (this: unknown, callback, delay) {
        if (this !== undefined) throw new TypeError('Illegal invocation');
        return setTimeout(callback, delay);
    };
    env.host.clearTimeout = function (this: unknown, timer) {
        if (this !== undefined) throw new TypeError('Illegal invocation');
        clearTimeout(timer);
    };
    const stop = startMarketRefresh({ loader: async () => 'quote', onData, onError: vi.fn(), intervalMs: 15_000, host: env.host });
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith('quote', expect.any(Number));
    expect(() => stop()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
});

describe.each(Object.entries(QUOTE_REFRESH_MS))('%s quote refresh', (_mode, intervalMs) => {
    it('loads immediately without a seed and polls a seeded snapshot only at its actual interval', async () => {
        vi.useFakeTimers();
        const env = environment();
        const loader = vi.fn(async () => ({ t: 123 }));
        const stop = startMarketRefresh({ loader, onData: vi.fn(), onError: vi.fn(), intervalMs, host: env.host });
        await vi.advanceTimersByTimeAsync(0);
        expect(loader).toHaveBeenCalledTimes(1);
        stop();
        loader.mockClear();
        const stopSeeded = startMarketRefresh({ loader, onData: vi.fn(), onError: vi.fn(), intervalMs, seeded: true, host: env.host });
        await vi.advanceTimersByTimeAsync(intervalMs - 1);
        expect(loader).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(loader).toHaveBeenCalledTimes(1);
        stopSeeded();
    });

    it('pauses hidden timers and refreshes a due resource when visible without overlapping requests', async () => {
        vi.useFakeTimers();
        const env = environment();
        const body = deferred<{ t: number }>();
        const loader = vi.fn(() => body.promise);
        const onData = vi.fn();
        const stop = startMarketRefresh({ loader, onData, onError: vi.fn(), intervalMs, host: env.host });
        await vi.advanceTimersByTimeAsync(0);
        env.visibility(false);
        await vi.advanceTimersByTimeAsync(intervalMs * 3);
        env.visibility(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(loader).toHaveBeenCalledTimes(1);
        body.resolve({ t: 100 });
        await vi.advanceTimersByTimeAsync(0);
        expect(onData).toHaveBeenCalledTimes(1);
        env.visibility(false);
        await vi.advanceTimersByTimeAsync(intervalMs * 2);
        expect(loader).toHaveBeenCalledTimes(1);
        env.visibility(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(loader).toHaveBeenCalledTimes(2);
        stop();
    });

    it('keeps last good source and fetched timestamps after a failed refresh and recovers later', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const env = environment();
        const loader = vi.fn<() => Promise<{ t: number }>>()
            .mockResolvedValueOnce({ t: 111 })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ t: 222 });
        let state = { data: { t: 0 }, fetchedAt: 0, stale: false };
        const stop = startMarketRefresh({ loader, intervalMs, host: env.host,
            onData: (data, fetchedAt) => { state = { data, fetchedAt, stale: false }; },
            onError: () => { state = { ...state, stale: true }; },
        });
        await vi.advanceTimersByTimeAsync(0);
        const good = { ...state };
        await vi.advanceTimersByTimeAsync(intervalMs);
        expect(state).toEqual({ ...good, stale: true });
        expect(state.data.t).toBe(111);
        await vi.advanceTimersByTimeAsync(intervalMs);
        expect(state.data.t).toBe(222);
        expect(state.stale).toBe(false);
        stop();
    });

    it('invalidates an old identity after the full async body resolves and removes visibility listeners', async () => {
        vi.useFakeTimers();
        const env = environment();
        const oldBody = deferred<string>();
        const oldData = vi.fn();
        const oldError = vi.fn();
        const stopOld = startMarketRefresh({ loader: () => oldBody.promise, onData: oldData, onError: oldError, intervalMs, host: env.host });
        await vi.advanceTimersByTimeAsync(0);
        stopOld();
        const newData = vi.fn();
        const stopNew = startMarketRefresh({ loader: async () => 'new symbol', onData: newData, onError: vi.fn(), intervalMs, host: env.host });
        await vi.advanceTimersByTimeAsync(0);
        oldBody.resolve('old symbol');
        await vi.advanceTimersByTimeAsync(0);
        expect(oldData).not.toHaveBeenCalled();
        expect(oldError).not.toHaveBeenCalled();
        expect(newData).toHaveBeenCalledWith('new symbol', expect.any(Number));
        stopNew();
        expect(env.listeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
