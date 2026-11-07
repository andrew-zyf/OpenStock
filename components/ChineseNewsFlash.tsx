'use client';

import React, { useEffect, useState, useTransition } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { getChineseLiveNews, type ChineseNewsItem } from "@/lib/actions/china-market.actions";
import Panel from "@/components/Panel";

export default function ChineseNewsFlash({ initialNews }: { initialNews?: ChineseNewsItem[] }) {
    const [news, setNews] = useState<ChineseNewsItem[]>(initialNews ?? []);
    const [loading, setLoading] = useState(false);
    const [isPending, startTransition] = useTransition();

    const refresh = () => {
        setLoading(true);
        getChineseLiveNews().then((data) => {
            startTransition(() => {
                setNews(data);
                setLoading(false);
            });
        });
    };

    useEffect(() => {
        if (!initialNews || initialNews.length === 0) {
            refresh();
        }
        // Auto-refresh every 60 seconds
        const timer = setInterval(refresh, 60_000);
        return () => clearInterval(timer);
    }, []);

    const action = (
        <button
            type="button"
            onClick={refresh}
            disabled={loading || isPending}
            className="btn btn-ghost h-7 px-2 text-[12px] text-faint hover:text-foreground"
            title="刷新 7x24 实时快讯"
        >
            <RefreshCw className={`size-3.5 ${loading || isPending ? 'animate-spin' : ''}`} />
            <span>刷新</span>
        </button>
    );

    return (
        <Panel
            title="7×24 财经快讯"
            sub="新浪财经实时电报 · 包含重大财经与宏观政策"
            action={action}
        >
            <div className="scrollbar-hide-default flex h-[560px] flex-col divide-y divide-line overflow-y-auto p-2">
                {news.length === 0 ? (
                    <div className="flex size-full items-center justify-center text-sm text-faint">
                        {loading ? '正在同步最新财经快讯...' : '暂无最新快讯'}
                    </div>
                ) : (
                    news.map((item) => (
                        <article key={item.id} className="group flex flex-col gap-1.5 p-3.5 transition-colors hover:bg-hover/40">
                            <div className="flex items-center gap-2 text-xs">
                                <span className="flex items-center gap-1 font-mono font-semibold text-brand-ink">
                                    <Clock className="size-3" />
                                    {item.time}
                                </span>
                                {item.source && (
                                    <span className="pill text-[10.5px] px-1.5 py-0.2 bg-white/5 text-muted-foreground">
                                        {item.source}
                                    </span>
                                )}
                            </div>
                            <p className="text-[13.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
                                {item.title}
                            </p>
                            {item.content && item.content !== item.title && (
                                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                                    {item.content}
                                </p>
                            )}
                        </article>
                    ))
                )}
            </div>
        </Panel>
    );
}
