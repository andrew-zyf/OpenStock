export type RefreshHost = {
    now: () => number;
    visible: () => boolean;
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
    subscribe: (callback: () => void) => () => void;
};

export const QUOTE_REFRESH_MS = { realtime: 15_000, cached: 3_600_000 } as const;

/** One request at a time; a hidden tab keeps its deadline without running timers. */
export function startMarketRefresh<T>({ loader, onData, onError, intervalMs, seeded = false, host }: {
    loader: () => Promise<T>;
    onData: (data: T, fetchedAt: number) => void;
    onError: (error: Error) => void;
    intervalMs?: number;
    seeded?: boolean;
    host: RefreshHost;
}): () => void {
    // Native browser timers reject a foreign receiver such as the host object.
    const { setTimeout: setTimer, clearTimeout: clearTimer } = host;
    let active = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dueAt = seeded && intervalMs ? host.now() + intervalMs : host.now();
    const clear = () => {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
    };
    const schedule = () => {
        clear();
        if (!active || pending || !host.visible() || dueAt === Infinity) return;
        timer = setTimer(run, Math.max(0, dueAt - host.now()));
    };
    const run = async () => {
        clear();
        if (!active || pending || !host.visible()) return;
        pending = true;
        try {
            const data = await loader();
            if (active) onData(data, host.now());
        } catch (error) {
            if (active) onError(error instanceof Error ? error : new Error(String(error)));
        } finally {
            pending = false;
            dueAt = intervalMs ? host.now() + intervalMs : Infinity;
            schedule();
        }
    };
    const unsubscribe = host.subscribe(schedule);
    schedule();
    return () => { active = false; clear(); unsubscribe(); };
}
