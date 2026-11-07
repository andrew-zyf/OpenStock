'use client';

import React, { useEffect, useState } from "react";
import Panel from "@/components/Panel";
import { getLevel1OrderBook } from "@/lib/actions/realtime-market.actions";
import { formatPrice } from "@/lib/utils";
import type { Level1OrderBook } from "@/lib/realtime-market";

function formatTierVol(vol: number): string {
    if (!vol || vol <= 0) return '—';
    if (vol >= 1e6) return `${(vol / 1e4).toFixed(1)}万`;
    if (vol >= 1e4) return `${(vol / 1e4).toFixed(1)}万`;
    return vol.toLocaleString();
}

export default function OrderBookCard({ symbol }: { symbol: string }) {
    const [book, setBook] = useState<Level1OrderBook | null>(null);
    const [loading, setLoading] = useState(true);

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
                <Panel title="五档买卖盘口" sub="Level-1 实时盘口与委比委差">
                    <div className="flex h-64 items-center justify-center text-xs text-faint">
                        正在加载实时五档深度盘口...
                    </div>
                </Panel>
            );
        }
        return null;
    }

    const { bids, asks, totalBidVol, totalAskVol, orderRatio, orderDelta, outer, inner, limitUp, limitDown, currency } = book;
    const maxTierVol = Math.max(...bids.map((b) => b.volume), ...asks.map((a) => a.volume), 1);

    // Asks displayed from 卖5 down to 卖1
    const reversedAsks = [...asks].reverse();

    return (
        <Panel
            title="五档买卖盘口"
            sub="Level-1 零延迟实时深度 · 委比/委差与内外盘"
            action={<span className="mono text-[11px] text-faint">10秒刷新</span>}
        >
            <div className="flex flex-col gap-3 p-3.5 text-xs">
                {/* 委比、委差、内外盘数据栏 */}
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
                    {(outer != null && inner != null && outer > 0) && (
                        <>
                            <div className="flex items-center justify-between">
                                <span className="text-faint text-[11px]">外盘(买):</span>
                                <strong className="mono font-semibold text-up">{formatTierVol(outer)}</strong>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-faint text-[11px]">内盘(卖):</span>
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

                {/* 盘口买卖列表 */}
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
                                {/* 深度背景条 */}
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
                    <div className="my-1.5 flex items-center justify-between border-y border-line-strong py-1 px-2 bg-page/60">
                        <span className="text-[11px] font-medium text-foreground">现价</span>
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
                                {/* 深度背景条 */}
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
            </div>
        </Panel>
    );
}
