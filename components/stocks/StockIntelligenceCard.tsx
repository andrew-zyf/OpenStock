'use client';

import React, { useEffect, useState } from "react";
import { BookOpen, FileText, Newspaper, ExternalLink } from "lucide-react";
import Panel from "@/components/Panel";
import { getStockIntelligence, type StockIntelligenceData } from "@/lib/actions/stock-intelligence.actions";

type TabType = 'news' | 'reports' | 'announcements';

export default function StockIntelligenceCard({ symbol }: { symbol: string }) {
    const [data, setData] = useState<StockIntelligenceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabType>('news');

    useEffect(() => {
        let active = true;
        setLoading(true);
        getStockIntelligence(symbol).then((res) => {
            if (active) {
                setData(res);
                setLoading(false);
            }
        });
        return () => {
            active = false;
        };
    }, [symbol]);

    const hasReports = (data?.reports?.length ?? 0) > 0;
    const hasAnnouncements = (data?.announcements?.length ?? 0) > 0;

    const action = (
        <div className="flex items-center gap-1 rounded-lg bg-page/60 p-0.5 border border-line text-xs">
            <button
                type="button"
                onClick={() => setTab('news')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                    tab === 'news' ? 'bg-primary text-primary-foreground' : 'text-faint hover:text-foreground'
                }`}
            >
                <Newspaper className="size-3" />
                <span>个股要闻 ({data?.news?.length ?? 0})</span>
            </button>
            {hasReports && (
                <button
                    type="button"
                    onClick={() => setTab('reports')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                        tab === 'reports' ? 'bg-primary text-primary-foreground' : 'text-faint hover:text-foreground'
                    }`}
                >
                    <BookOpen className="size-3" />
                    <span>券商研报 ({data?.reports?.length ?? 0})</span>
                </button>
            )}
            {hasAnnouncements && (
                <button
                    type="button"
                    onClick={() => setTab('announcements')}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                        tab === 'announcements' ? 'bg-primary text-primary-foreground' : 'text-faint hover:text-foreground'
                    }`}
                >
                    <FileText className="size-3" />
                    <span>公司公告 ({data?.announcements?.length ?? 0})</span>
                </button>
            )}
        </div>
    );

    return (
        <Panel
            title="个股深度情报中心"
            sub={`${data?.name || symbol} · 专属实时快讯、券商机构研报盈利预测与交易所正式公告`}
            action={action}
        >
            <div className="p-4">
                {loading ? (
                    <div className="flex h-40 items-center justify-center text-xs text-faint">
                        正在检索个股专属资讯、券商研报与公司公告...
                    </div>
                ) : (
                    <>
                        {/* 1. 个股实时要闻 */}
                        {tab === 'news' && (
                            <div className="divide-y divide-line/60">
                                {data?.news?.length ? (
                                    data.news.map((item) => (
                                        <a
                                            key={item.id}
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-hover/30 rounded-lg px-2"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <h4 className="text-sm font-semibold text-foreground group-hover:text-brand-ink transition-colors">
                                                    {item.title}
                                                </h4>
                                                <ExternalLink className="size-3.5 shrink-0 text-faint opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                                            </div>
                                            {item.summary && (
                                                <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                                                    {item.summary}
                                                </p>
                                            )}
                                            <div className="flex items-center gap-2 text-[11px] text-faint mono">
                                                <span className="rounded bg-brand-soft/60 px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink">
                                                    {item.source}
                                                </span>
                                                <span>{item.date}</span>
                                            </div>
                                        </a>
                                    ))
                                ) : (
                                    <p className="py-8 text-center text-xs text-faint">暂无该标的近期专属新闻报道</p>
                                )}
                            </div>
                        )}

                        {/* 2. 券商机构研报与盈利预测 */}
                        {tab === 'reports' && (
                            <div className="divide-y divide-line/60">
                                {data?.reports?.map((rep) => (
                                    <a
                                        key={rep.id}
                                        href={rep.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex flex-col gap-2 py-3 first:pt-0 last:pb-0 transition-colors hover:bg-hover/30 rounded-lg px-2"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-400">
                                                    {rep.orgName}
                                                </span>
                                                <h4 className="truncate text-sm font-semibold text-foreground group-hover:text-brand-ink">
                                                    {rep.title}
                                                </h4>
                                            </div>
                                            <span className="mono shrink-0 text-[11px] text-faint">{rep.date}</span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground bg-page/40 px-3 py-1.5 rounded border border-line/60">
                                            <span>评级: <strong className="text-up">{rep.rating}</strong></span>
                                            {rep.thisYearEps && (
                                                <span>今年预测 EPS: <strong className="mono text-foreground">{rep.thisYearEps}</strong> (PE: {rep.thisYearPe || '—'})</span>
                                            )}
                                            {rep.nextYearEps && (
                                                <span>明年预测 EPS: <strong className="mono text-foreground">{rep.nextYearEps}</strong> (PE: {rep.nextYearPe || '—'})</span>
                                            )}
                                        </div>
                                    </a>
                                ))}
                            </div>
                        )}

                        {/* 3. 公司官方公告 */}
                        {tab === 'announcements' && (
                            <div className="divide-y divide-line/60">
                                {data?.announcements?.map((ann) => (
                                    <a
                                        key={ann.id}
                                        href={ann.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 transition-colors hover:bg-hover/30 rounded-lg px-2"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="shrink-0 rounded bg-page px-2 py-0.5 text-[10px] font-semibold text-faint border border-line">
                                                {ann.category}
                                            </span>
                                            <span className="truncate text-xs font-medium text-foreground group-hover:text-brand-ink">
                                                {ann.title}
                                            </span>
                                        </div>
                                        <span className="mono shrink-0 text-[11px] text-faint">{ann.date}</span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </Panel>
    );
}
