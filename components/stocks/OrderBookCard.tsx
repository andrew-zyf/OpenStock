'use client';

import React, { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import Panel from "@/components/Panel";
import { getLevel1OrderBook } from "@/lib/actions/realtime-market.actions";
import { formatPrice } from "@/lib/utils";
import type { Level1OrderBook } from "@/lib/realtime-market";

type ViewTab = 'both' | 'book' | 'ticks';

function formatTierVol(vol: number): string {
    if (!vol || vol <= 0) return '—';
    if (vol >= 1e4) return `${(vol / 1e4).toFixed(1)}万`;
    return vol.toLocaleString();
}

export default function OrderBookCard({ symbol }: { symbol: string }) {
    const [book, setBook] = useState<Level1OrderBook | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<ViewTab>('both');

    useEffect(() => {
        let active = true;
        const load = () => {
            getLevel1OrderBook(symbol).then((data) => {
                if (active) {
                    setBook(data);
                    setLoading(false);
                }
            });
        };

        load();
        const timer = setInterval(load, 10000); // 10s auto-polling
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [symbol]);

    if (!book) {
        if (loading) {
            return (
                <Panel title="五档盘口与逐笔明细" sub="Level-1 实时盘口与分时成交">
                    <div className="flex h-64 items-center justify-center text-xs text-faint">
                        正在加载实时五档深度盘口与逐笔明细...
                    </div>
                </Panel>
            );
        }
        return null;
    }

    const { bids, asks, orderRatio, orderDelta, outer, inner, limitUp, limitDown, currency, ticks = [], market } = book;
    const maxTierVol = Math.max(...bids.map((b) => b.volume), ...asks.map((a) => a.volume), 1);

    // Asks displayed from 卖5 down to 卖1
    const reversedAsks = [...asks].reverse();
    const unitLabel = market === 'cn' ? '手' : market === 'tw' ? '张' : '股';
    const bigOrderThreshold = market === 'cn' ? 100 : market === 'tw' ? 50 : 10000;

    const action = (
        <div className="flex items-center gap-1 rounded-lg bg-page/60 p-0.5 border border-line text-[11px]">
            {(
                [
                    { id: 'both', label: '同屏' },
                    { id: 'book', label: '五档' },
                    { id: 'ticks', label: '逐笔' },
                ] as const
            ).map((item) => (
                <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`rounded px-2 py-0.5 font-semibold transition-colors ${
                        tab === item.id ? 'bg-primary text-primary-foreground' : 'text-faint hover:text-foreground'
                    }`}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );

    return (
        <Panel
            title="五档盘口与逐笔成交"
            sub="Level-1 零延迟实时深度 · 委比委差与分时逐笔明细"
            action={action}
        >
            <div className="flex flex-col gap-3 p-3.5 text-xs">
                {/* 委比、委差、内外盘、涨跌停核心数据栏 */}
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-page/40 p-2 border border-line">
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">委比:</span>
                        <strong className={`mono font-semibold ${orderRatio >= 0 ? 'text-up' : 'text-down'}`}>
                            {orderRatio >= 0 ? `+${orderRatio.toFixed(2)}%` : `${orderRatio.toFixed(2)}%`}
                        </strong>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">委差:</span>
                        <strong className={`mono font-semibold ${orderDelta >= 0 ? 'text-up' : 'text-down'}`}>
                            {orderDelta >= 0 ? `+${orderDelta.toLocaleString()}` : orderDelta.toLocaleString()}
                        </strong>
                    </div>
                    {(outer != null && inner != null && (outer > 0 || inner > 0)) && (
                        <>
                            <div className="flex items-center justify-between">
                                <span className="text-faint text-[11px]">外盘(主动买):</span>
                                <strong className="mono font-semibold text-up">{formatTierVol(outer)}</strong>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-faint text-[11px]">内盘(主动卖):</span>
                                <strong className="mono font-semibold text-down">{formatTierVol(inner)}</strong>
                            </div>
                        </>
                    )}
                    {limitUp != null && (
                        <div className="flex items-center justify-between">
                            <span className="text-faint text-[11px]">涨停价:</span>
                            <strong className="mono font-semibold text-up">{formatPrice(limitUp, currency)}</strong>
                        </div>
                    )}
                    {limitDown != null && (
                        <div className="flex items-center justify-between">
                            <span className="text-faint text-[11px]">跌停价:</span>
                            <strong className="mono font-semibold text-down">{formatPrice(limitDown, currency)}</strong>
                        </div>
                    )}
                </div>

                {/* 1. 五档买卖盘口列表 */}
                {(tab === 'both' || tab === 'book') && (
                    <div className="flex flex-col gap-0.5">
                        {/* 卖五至卖一 */}
                        {reversedAsks.map((ask, idx) => {
                            const tierNum = 5 - idx;
                            const depthPct = Math.min(100, Math.round((ask.volume / maxTierVol) * 100));
                            return (
                                <div
                                    key={`ask-${tierNum}`}
                                    className="relative flex items-center justify-between py-1 px-2 rounded overflow-hidden hover:bg-hover/40"
                                >
                                    <div
                                        className="absolute inset-y-0 right-0 bg-emerald-500/10 pointer-events-none transition-all"
                                        style={{ width: `${depthPct}%` }}
                                    />
                                    <span className="text-faint text-[11px] z-10 w-12">卖{tierNum}</span>
                                    <span className="mono font-semibold text-down z-10">
                                        {ask.price > 0 ? formatPrice(ask.price, currency) : '—'}
                                    </span>
                                    <span className="mono text-faint z-10 text-right w-16">
                                        {formatTierVol(ask.volume)}
                                    </span>
                                </div>
                            );
                        })}

                        {/* 最新现价基准分割线 */}
                        <div className="my-1 flex items-center justify-between border-y border-line-strong py-1 px-2 bg-page/60">
                            <span className="text-[11px] font-medium text-foreground">最新成交</span>
                            <div className="flex items-center gap-2">
                                <span className={`mono text-sm font-bold ${book.change >= 0 ? 'text-up' : 'text-down'}`}>
                                    {formatPrice(book.latestPrice, currency)}
                                </span>
                                <span className={`mono text-xs font-semibold ${book.change >= 0 ? 'text-up' : 'text-down'}`}>
                                    {book.changePercent >= 0 ? `+${book.changePercent.toFixed(2)}%` : `${book.changePercent.toFixed(2)}%`}
                                </span>
                            </div>
                        </div>

                        {/* 买一至买五 */}
                        {bids.map((bid, idx) => {
                            const tierNum = idx + 1;
                            const depthPct = Math.min(100, Math.round((bid.volume / maxTierVol) * 100));
                            return (
                                <div
                                    key={`bid-${tierNum}`}
                                    className="relative flex items-center justify-between py-1 px-2 rounded overflow-hidden hover:bg-hover/40"
                                >
                                    <div
                                        className="absolute inset-y-0 right-0 bg-red-500/10 pointer-events-none transition-all"
                                        style={{ width: `${depthPct}%` }}
                                    />
                                    <span className="text-faint text-[11px] z-10 w-12">买{tierNum}</span>
                                    <span className="mono font-semibold text-up z-10">
                                        {bid.price > 0 ? formatPrice(bid.price, currency) : '—'}
                                    </span>
                                    <span className="mono text-faint z-10 text-right w-16">
                                        {formatTierVol(bid.volume)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* 2. 逐笔成交明细 (Tick-by-Tick Time & Sales) */}
                {(tab === 'both' || tab === 'ticks') && ticks.length > 0 && (
                    <div className="flex flex-col gap-1 border-t border-line pt-2.5">
                        <div className="flex items-center justify-between px-1 text-[11px] text-faint">
                            <span className="font-semibold text-foreground">分时逐笔成交明细</span>
                            <span>单位: {unitLabel} (B主动买 / S主动卖)</span>
                        </div>
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-page/30 divide-y divide-line/40">
                            {ticks.slice(0, tab === 'ticks' ? 15 : 8).map((t, i) => {
                                const isBig = t.volume >= bigOrderThreshold;
                                const sideColor = t.side === 'B' ? 'text-up' : t.side === 'S' ? 'text-down' : 'text-faint';
                                return (
                                    <div
                                        key={`${t.time}-${i}`}
                                        className={`flex items-center justify-between px-2.5 py-1 mono text-[11px] ${
                                            isBig ? 'bg-amber-500/10 font-semibold' : 'hover:bg-hover/30'
                                        }`}
                                    >
                                        <span className="text-faint w-16">{t.time}</span>
                                        <span className={`font-semibold ${t.price >= book.prevClose ? 'text-up' : 'text-down'}`}>
                                            {t.price.toFixed(2)}
                                        </span>
                                        <span className="flex items-center justify-end gap-1 w-20 text-right">
                                            {isBig && <Flame className="size-3 text-amber-400 shrink-0" title="主力大单异动" />}
                                            <span className="text-foreground">{formatTierVol(t.volume)}</span>
                                            <span className={`font-bold ${sideColor}`}>{t.side}</span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </Panel>
    );
}
