"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Bell, Search, Star } from "lucide-react";
import CreateAlertModal from "./CreateAlertModal";
import WatchlistButton from "@/components/WatchlistButton";
import ChangePill from "@/components/ChangePill";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuoteResource } from "@/hooks/useLiveQuotes";
import { SearchButton } from "@/components/SearchCommand";
import { formatNumber, formatPrice } from "@/lib/utils";
import { identifyMarketAndCode } from "@/lib/market/instrument";
import { getInstrumentCapabilities } from "@/lib/market/capabilities";
import { alertsEnabled, isRealtime } from "@/lib/market-data";
import type { getWatchlistData } from "@/lib/actions/finnhub.actions";

type Row = Awaited<ReturnType<typeof getWatchlistData>>[number];
type MarketFilter = 'all' | 'us' | 'cn' | 'hk' | 'tw';
type SortField = 'default' | 'changePercent' | 'price' | 'marketCap';

const SUGGESTIONS = [
    { symbol: 'AAPL', label: '苹果 (美股)' },
    { symbol: 'NVDA', label: '英伟达 (美股)' },
    { symbol: '600519.SS', label: '贵州茅台 (A股)' },
    { symbol: '300750.SZ', label: '宁德时代 (A股)' },
    { symbol: '0700.HK', label: '腾讯控股 (港股)' },
    { symbol: '9988.HK', label: '阿里巴巴 (港股)' },
    { symbol: '2330.TW', label: '台积电 (台股)' },
    { symbol: '2454.TW', label: '联发科 (台股)' },
];

function getMarketOfSymbol(symbol: string): 'us' | 'cn' | 'hk' | 'tw' {
    return identifyMarketAndCode(symbol).market;
}

export default function WatchlistTable({ initialRows }: { initialRows: Row[] }) {
    const [baseRows, setBaseRows] = useState(initialRows);
    const [marketFilter, setMarketFilter] = useState<MarketFilter>('all');
    const [sortField, setSortField] = useState<SortField>('default');
    const [sortAsc, setSortAsc] = useState<boolean>(false);

    const quotes = useLiveQuoteResource(baseRows.map((r) => r.symbol));
    const live = quotes.data ?? {};

    // Server re-renders replace the local copy
    useEffect(() => setBaseRows(initialRows), [initialRows]);

    const liveRows = baseRows.map((r) => {
        const q = live[r.symbol];
        return q?.c != null ? { ...r, price: q.c, change: q.d, changePercent: q.dp, marketCap: q.marketCap ?? r.marketCap } : r;
    });

    const filteredRows = liveRows.filter((row) => {
        if (marketFilter === 'all') return true;
        return getMarketOfSymbol(row.symbol) === marketFilter;
    });

    const sortedRows = [...filteredRows].sort((a, b) => {
        if (sortField === 'changePercent') {
            const diff = (a.changePercent || 0) - (b.changePercent || 0);
            return sortAsc ? diff : -diff;
        }
        if (sortField === 'price') {
            const diff = (a.price || 0) - (b.price || 0);
            return sortAsc ? diff : -diff;
        }
        if (sortField === 'marketCap') {
            const diff = (a.marketCap || 0) - (b.marketCap || 0);
            return sortAsc ? diff : -diff;
        }
        return 0;
    });

    const counts = {
        all: liveRows.length,
        us: liveRows.filter((r) => getMarketOfSymbol(r.symbol) === 'us').length,
        cn: liveRows.filter((r) => getMarketOfSymbol(r.symbol) === 'cn').length,
        hk: liveRows.filter((r) => getMarketOfSymbol(r.symbol) === 'hk').length,
        tw: liveRows.filter((r) => getMarketOfSymbol(r.symbol) === 'tw').length,
    };

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(false);
        }
    };

    if (liveRows.length === 0) {
        return (
            <div className="empty-state">
                <span className="empty-icon"><Star className="size-5" /></span>
                <h3>自选列表暂无股票</h3>
                <p className="max-w-sm">覆盖美股、A股、港股、台股四大市场，搜索标的并点击星标即可加入自选并开启盘中实时分时监控。</p>
                <SearchButton className="btn btn-primary mt-3"><Search /> 搜索股票</SearchButton>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {SUGGESTIONS.map((s) => (
                        <Link key={s.symbol} href={`/stocks/${s.symbol}`} className="pill mono h-7 px-3 hover:bg-hover hover:text-foreground">
                            {s.label}
                        </Link>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {/* 雪球式市场分类切换栏 */}
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <div className="flex items-center gap-1">
                    {(
                        [
                            { id: 'all', label: '全部' },
                            { id: 'us', label: '美股' },
                            { id: 'cn', label: 'A股' },
                            { id: 'hk', label: '港股' },
                            { id: 'tw', label: '台股' },
                        ] as const
                    ).map((tab) => {
                        const active = marketFilter === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setMarketFilter(tab.id)}
                                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    active
                                        ? 'bg-hover text-foreground'
                                        : 'text-faint hover:text-foreground'
                                }`}
                            >
                                <span>{tab.label}</span>
                                <span className="text-[10px] opacity-70">({counts[tab.id]})</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2 text-xs text-faint">
                    <span className="mono">{isRealtime ? '15 秒轮询' : '每小时轮询'}{quotes.stale ? ' · 更新失败，保留上次报价' : ''}</span>
                </div>
            </div>

            {/* 自选股行情列表 */}
            {sortedRows.length === 0 ? (
                <div className="py-10 text-center text-xs text-faint">
                    该市场分类下暂无已关注股票，切换至“全部”或点击右上角搜索添加。
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>公司</th>
                                <th className="is-num cursor-pointer select-none" onClick={() => toggleSort('price')}>
                                    <span className="inline-flex items-center gap-1">
                                        最新价
                                        <ArrowUpDown className="size-3 opacity-50" />
                                    </span>
                                </th>
                                <th className="is-num cursor-pointer select-none" onClick={() => toggleSort('changePercent')}>
                                    <span className="inline-flex items-center gap-1">
                                        今日涨跌
                                        <ArrowUpDown className="size-3 opacity-50" />
                                    </span>
                                </th>
                                <th className="is-num">涨跌额</th>
                                <th className="is-num cursor-pointer select-none" onClick={() => toggleSort('marketCap')}>
                                    <span className="inline-flex items-center gap-1">
                                        总市值
                                        <ArrowUpDown className="size-3 opacity-50" />
                                    </span>
                                </th>
                                <th className="w-[88px]"><span className="sr-only">操作</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRows.map((row) => {
                                const m = getMarketOfSymbol(row.symbol);
                                const badgeClass =
                                    m === 'cn'
                                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                        : m === 'hk'
                                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                            : m === 'tw'
                                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20';

                                const marketTag = m === 'cn' ? 'A股' : m === 'hk' ? '港股' : m === 'tw' ? '台股' : '美股';

                                return (
                                    <tr key={row.symbol}>
                                        <td className="max-w-[320px]">
                                            <Link href={`/stocks/${row.symbol}`} className="group flex items-center gap-3">
                                                {row.logo ? (
                                                    <span className="logo-well"><img src={row.logo} alt="" className="size-full object-contain p-1" /></span>
                                                ) : (
                                                    <span className="logo-well is-empty">{row.symbol[0]}</span>
                                                )}
                                                <span className="min-w-0">
                                                    <span className="flex items-center gap-1.5">
                                                        <span className="truncate font-semibold text-foreground transition-colors group-hover:text-brand-ink" title={row.name}>
                                                            {row.name}
                                                        </span>
                                                        <span className={`pill mono px-1 py-0.2 text-[10px] font-semibold ${badgeClass}`}>
                                                            {marketTag}
                                                        </span>
                                                    </span>
                                                    <span className="mono block text-[12px] text-faint">{row.symbol}</span>
                                                </span>
                                            </Link>
                                        </td>
                                        <td className="is-num font-semibold text-foreground">
                                            <PriceFlash value={row.price} className="px-1">
                                                {row.price ? formatPrice(row.price, row.currency) : '—'}
                                            </PriceFlash>
                                        </td>
                                        <td className="is-num">
                                            <ChangePill value={row.price ? row.changePercent : null} />
                                        </td>
                                        <td className={`is-num font-medium ${row.change == null ? 'text-muted-foreground' : row.change > 0 ? 'text-up' : row.change < 0 ? 'text-down' : 'text-muted-foreground'}`}>
                                            {row.price != null && row.change != null ? `${row.change > 0 ? '+' : ''}${row.change.toFixed(2)}` : '—'}
                                        </td>
                                        <td className="is-num text-muted-foreground">
                                            {row.marketCap != null ? formatNumber(row.marketCap) : '—'}
                                        </td>
                                        <td>
                                            <div className="flex items-center justify-end gap-1">
                                                {alertsEnabled && getInstrumentCapabilities(row.symbol).alerts ? (
                                                    <CreateAlertModal symbol={row.symbol} currentPrice={row.price} currency={row.currency}>
                                                        <button type="button" className="icon-btn" title={`为 ${row.symbol} 设置价格预警`} aria-label={`为 ${row.symbol} 设置价格预警`}>
                                                            <Bell />
                                                        </button>
                                                    </CreateAlertModal>
                                                ) : (
                                                    <span className="icon-btn opacity-40" title="价格预警需要支持的美股标的及实时部署模式"><Bell /></span>
                                                )}
                                                <WatchlistButton
                                                    symbol={row.symbol}
                                                    company={row.name}
                                                    isInWatchlist
                                                    variant="icon"
                                                    onWatchlistChange={(sym, added) => {
                                                        if (!added) setBaseRows((current) => current.filter((r) => r.symbol !== sym));
                                                    }}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
