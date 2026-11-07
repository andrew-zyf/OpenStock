'use client';

import { useEffect, useState } from 'react';
import { isRealtime } from '@/lib/market-data';

const DataFreshness = ({ tradeTime, asOf, source, fetchedAt, stale = false, loading = false }: {
    tradeTime?: number; asOf?: string; source?: string; fetchedAt?: string; stale?: boolean; loading?: boolean;
}) => {
    const [time, setTime] = useState<string | null>(null);
    const [fetched, setFetched] = useState<string | null>(null);
    useEffect(() => {
        const format = (value?: string | number) => {
            if (!value) return null;
            const date = new Date(value);
            return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', {
                month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
            }) : null;
        };
        setTime(format(asOf || (tradeTime && tradeTime > 0 ? tradeTime * 1000 : undefined)));
        setFetched(format(fetchedAt));
    }, [tradeTime, asOf, fetchedAt]);
    return <span className="text-[12px] text-faint">
        {source ? `${source} · ` : ''}{time ? `截至 ${time}` : '源时间未提供'}
        {fetched ? ` · 获取于 ${fetched}` : ''}
        {stale ? ' · 更新失败，保留上次数据' : loading ? ' · 加载中' : ''}
        {' · '}{isRealtime ? '15秒轮询' : '每小时轮询'}
    </span>;
};

export default DataFreshness;
