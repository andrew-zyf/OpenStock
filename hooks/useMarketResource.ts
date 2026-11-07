'use client';

import { useEffect, useRef, useState } from 'react';
import { startMarketRefresh } from '@/lib/market/refresh';

type ResourceState<T> = {
    data: T | undefined;
    loading: boolean;
    error: Error | null;
    stale: boolean;
    fetchedAt: number | undefined;
};

export function useMarketResource<T>({ key, loader, initialData, intervalMs, enabled = true }: {
    key: string;
    loader: () => Promise<T>;
    initialData?: T;
    intervalMs?: number;
    enabled?: boolean;
}): ResourceState<T> {
    const identity = `${enabled}:${key}`;
    const loaderRef = useRef(loader);
    loaderRef.current = loader;
    const [state, setState] = useState<ResourceState<T> & { identity: string }>(() => ({
        identity, data: enabled ? initialData : undefined, loading: enabled && initialData === undefined,
        error: null, stale: false, fetchedAt: undefined,
    }));
    // A new identity must never render the previous instrument's data, even before effects run.
    const current = state.identity === identity ? state : {
        data: enabled ? initialData : undefined, loading: enabled && initialData === undefined,
        error: null, stale: false, fetchedAt: undefined,
    };

    useEffect(() => {
        setState({ identity, data: enabled ? initialData : undefined,
            loading: enabled && initialData === undefined, error: null, stale: false, fetchedAt: undefined });
        if (!enabled) return;
        return startMarketRefresh({
            loader: () => loaderRef.current(), intervalMs, seeded: initialData !== undefined,
            onData: (data, fetchedAt) => setState({ identity, data, fetchedAt, loading: false, error: null, stale: false }),
            onError: (error) => setState((previous) => ({ ...previous, loading: false, error, stale: previous.data !== undefined })),
            host: {
                now: Date.now,
                visible: () => document.visibilityState !== 'hidden',
                setTimeout: (callback, delay) => setTimeout(callback, delay),
                clearTimeout: (timer) => clearTimeout(timer),
                subscribe: (callback) => {
                    document.addEventListener('visibilitychange', callback);
                    return () => document.removeEventListener('visibilitychange', callback);
                },
            },
        });
        // Seed changes do not replace a newer successful snapshot for the same identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity, intervalMs, enabled]);

    return current;
}
