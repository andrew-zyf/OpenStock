'use client';

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ArrowUpRight, Newspaper } from 'lucide-react';
import { articleMarkets } from '@/lib/news/relevance';

type MarketFilter = 'all' | 'us' | 'cn' | 'hk' | 'tw';
type NewsView = 'watchlist' | 'market';
const TABS: { id: MarketFilter; label: string }[] = [
    { id: 'all', label: '全部市场' }, { id: 'us', label: '美股' },
    { id: 'cn', label: 'A股' }, { id: 'hk', label: '港股' }, { id: 'tw', label: '台股' },
];
const REASONS: Record<NewsAssociation['reason'], string> = {
    'source-symbol': '来源标注代码', 'source-company': '来源标注公司', 'company-name': '名称匹配', ticker: '代码匹配',
};

type NewsListProps = {
    news: MarketNewsArticle[];
    marketNews?: MarketNewsArticle[];
    status?: 'ready' | 'empty' | 'partial' | 'error';
    sources?: NewsSourceStatus[];
    coverage?: WatchlistNewsCoverage;
};

export function selectNewsView(news: MarketNewsArticle[], marketNews: MarketNewsArticle[], view: NewsView, filter: MarketFilter): MarketNewsArticle[] {
    const articles = view === 'watchlist' ? news.filter((item) => item.relatedSymbols?.length && item.associations?.length) : marketNews;
    return articles.filter((item) => filter === 'all' || articleMarkets(item, view === 'watchlist').includes(filter));
}

function pillStyle(item: MarketNewsArticle, relatedOnly: boolean): string {
    const market = articleMarkets(item, relatedOnly)[0];
    if (market === 'cn') return 'bg-red-500/10 text-red-400 border border-red-500/20';
    if (market === 'hk') return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
    if (market === 'tw') return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
}

export default function NewsList({ news = [], marketNews = [], status = 'empty', sources = [], coverage }: NewsListProps) {
    const [view, setView] = useState<NewsView>('watchlist');
    const [filter, setFilter] = useState<MarketFilter>('all');
    const filtered = selectNewsView(news, marketNews, view, filter);
    const failures = sources.filter((source) => source.status === 'error' && (view === 'watchlist' || source.scope === 'market'));
    const emptyWatchlist = view === 'watchlist' && coverage?.requested === 0;
    const hasFailure = view === 'watchlist' ? status === 'partial' || status === 'error' : failures.length > 0;

    return (
        <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2" aria-label="资讯范围">
                {([{ id: 'watchlist', label: '自选相关' }, { id: 'market', label: '全市场' }] as const).map((tab) => (
                    <button key={tab.id} type="button" aria-pressed={view === tab.id} onClick={() => setView(tab.id)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${view === tab.id ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'}`}>
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2" aria-label="资讯市场">
                {TABS.map((tab) => (
                    <button key={tab.id} type="button" aria-pressed={filter === tab.id} onClick={() => setFilter(tab.id)}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${filter === tab.id ? 'bg-hover text-foreground' : 'text-faint hover:text-foreground'}`}>
                        <span>{tab.label}</span>
                        <span className="text-[10px] opacity-70">({selectNewsView(news, marketNews, view, tab.id).length})</span>
                    </button>
                ))}
            </div>
            {hasFailure && (
                <p role="status" className="border-b border-line px-3.5 py-2 text-xs text-faint">
                    {status === 'error' && view === 'watchlist' ? '资讯来源暂时不可用，请稍后重试。' : '部分资讯来源更新失败，当前结果可能不完整。'}
                    {failures.length > 0 && `（${[...new Set(failures.map((source) => source.label))].join('、')}）`}
                </p>
            )}
            {view === 'watchlist' && !!coverage?.requested && (
                <p className="border-b border-line px-3.5 py-2 text-xs text-faint">
                    已筛选 {coverage.requested} 只自选的市场资讯，并尝试检索其中 {coverage.targeted} 只；不保证逐标的完整覆盖。
                    {!!coverage.feedOnlySymbols.length && ` ${coverage.feedOnlySymbols.length} 只仅筛选市场资讯。`}
                </p>
            )}
            {filtered.length === 0 ? (
                <div className="empty-state py-8">
                    <span className="empty-icon"><Newspaper className="size-5" /></span>
                    <h3 className="text-sm font-semibold">{emptyWatchlist ? '添加自选后查看相关资讯' : hasFailure ? '暂未取得该范围的资讯' : view === 'watchlist' ? '暂无匹配的自选资讯' : '该分类下暂无最新资讯'}</h3>
                    <p className="text-xs text-faint">{view === 'watchlist' ? '“全市场”可查看市场动态；未匹配的资讯不会列为自选相关。' : '可切换市场分类查看其他动态。'}</p>
                </div>
            ) : (
                <ul className="row-list">
                    {filtered.map((item) => {
                        const reasons = item.associations?.map((match) => `${match.symbol} · ${REASONS[match.reason]}：${match.matchedText}`).join('；');
                        const knownTime = Number.isFinite(item.datetime) && item.datetime > 0 && !Number.isNaN(new Date(item.datetime * 1000).getTime());
                        return (
                            <li key={`${item.id}-${item.url}`}>
                                <a href={item.url} target="_blank" rel="noopener noreferrer"
                                    className="group flex items-start gap-3 px-3.5 py-3 transition-colors hover:bg-hover/50">
                                    <span className={`pill mono mt-0.5 max-w-28 shrink-0 break-all px-2 py-0.5 text-[11px] font-semibold ${pillStyle(item, view === 'watchlist')}`}>
                                        {view === 'watchlist' ? item.relatedSymbols?.join(' · ') : item.category || 'MKT'}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="line-clamp-2 text-[13.5px] font-semibold text-foreground transition-colors group-hover:text-brand-ink">{item.headline}</span>
                                        {view === 'watchlist' && reasons && <span className="mt-1 block text-[11px] text-faint">{reasons}</span>}
                                        <span className="mt-1 block truncate text-[12px] text-faint">
                                            {item.source || '来源未提供'} · {knownTime ? formatDistanceToNow(item.datetime * 1000, { addSuffix: true, locale: zhCN }) : '发布时间未知'}
                                        </span>
                                    </span>
                                    <ArrowUpRight className="mt-1 size-4 flex-none text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                                </a>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
