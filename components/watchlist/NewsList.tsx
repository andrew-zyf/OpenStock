'use client';

import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ArrowUpRight, Newspaper } from "lucide-react";

type MarketFilter = 'all' | 'us' | 'cn' | 'hk' | 'tw';

const TABS: { id: MarketFilter; label: string }[] = [
    { id: 'all', label: '全部资讯' },
    { id: 'us', label: '美股' },
    { id: 'cn', label: 'A股' },
    { id: 'hk', label: '港股' },
    { id: 'tw', label: '台股' },
];

export default function NewsList({ news = [] }: { news: MarketNewsArticle[] }) {
    const [filter, setFilter] = useState<MarketFilter>('all');

    const matchesFilter = (item: MarketNewsArticle, f: MarketFilter) => {
        if (f === 'all') return true;
        const cat = item.category || '';
        const rel = item.related || '';
        if (f === 'us') return cat === '美股' || cat === 'general' || cat === 'company' || rel === '美股' || /^[A-Z]{1,5}$/.test(rel);
        if (f === 'cn') return cat === 'A股' || rel === 'A股' || rel.endsWith('.SS') || rel.endsWith('.SZ') || /^\d{6}/.test(rel);
        if (f === 'hk') return cat === '港股' || rel === '港股' || rel.endsWith('.HK') || /^\d{4,5}/.test(rel);
        if (f === 'tw') return cat === '台股' || rel === '台股' || rel.endsWith('.TW') || rel.endsWith('.TWO');
        return true;
    };

    const filtered = news.filter((item) => matchesFilter(item, filter));

    const getPillStyle = (item: MarketNewsArticle) => {
        const cat = item.category || item.related || '';
        if (cat.includes('A股') || cat.endsWith('.SS') || cat.endsWith('.SZ')) {
            return 'bg-red-500/10 text-red-400 border border-red-500/20';
        }
        if (cat.includes('港股') || cat.endsWith('.HK')) {
            return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
        }
        if (cat.includes('台股') || cat.endsWith('.TW')) {
            return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
        }
        return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    };

    return (
        <div className="flex flex-col">
            {/* 市场过滤栏 */}
            <div className="flex items-center gap-1 border-b border-line px-3 py-2">
                {TABS.map((tab) => {
                    const active = filter === tab.id;
                    const count = tab.id === 'all' ? news.length : news.filter((n) => matchesFilter(n, tab.id)).length;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setFilter(tab.id)}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                                active
                                    ? 'bg-hover text-foreground'
                                    : 'text-faint hover:text-foreground'
                            }`}
                        >
                            <span>{tab.label}</span>
                            <span className="text-[10px] opacity-70">({count})</span>
                        </button>
                    );
                })}
            </div>

            {/* 资讯列表 */}
            {filtered.length === 0 ? (
                <div className="empty-state py-8">
                    <span className="empty-icon"><Newspaper className="size-5" /></span>
                    <h3 className="text-sm font-semibold">该分类下暂无最新资讯</h3>
                    <p className="text-xs text-faint">切换至“全部资讯”查看全市场动态。</p>
                </div>
            ) : (
                <ul className="row-list">
                    {filtered.map((item) => (
                        <li key={`${item.id}-${item.url}`}>
                            <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-start gap-3 px-3.5 py-3 transition-colors hover:bg-hover/50"
                            >
                                <span className={`pill mono mt-0.5 shrink-0 px-2 py-0.5 text-[11px] font-semibold ${getPillStyle(item)}`}>
                                    {item.related || item.category || 'MKT'}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="line-clamp-2 text-[13.5px] font-semibold text-foreground transition-colors group-hover:text-brand-ink">
                                        {item.headline}
                                    </span>
                                    <span className="mt-1 block truncate text-[12px] text-faint">
                                        {item.source}
                                        {item.datetime
                                            ? ` · ${formatDistanceToNow(item.datetime * 1000, { addSuffix: true, locale: zhCN })}`
                                            : ''}
                                    </span>
                                </span>
                                <ArrowUpRight className="mt-1 size-4 flex-none text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                            </a>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
