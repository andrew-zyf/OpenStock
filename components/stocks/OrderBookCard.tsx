'use client';

import React, { useState } from "react";
import { useMarketResource } from '@/hooks/useMarketResource';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { Flame } from "lucide-react";
import Panel from "@/components/Panel";
import { getLevel1OrderBook } from "@/lib/actions/realtime-market.actions";
import { formatPrice } from "@/lib/utils";
import type { Level1OrderBook } from "@/lib/realtime-market";

type ViewTab = 'both' | 'book' | 'ticks';

function formatTierVol(vol: number): string {
    if (!Number.isFinite(vol) || vol < 0) return '—';
    if (vol >= 1e4) return `${(vol / 1e4).toFixed(1)}万`;
    return vol.toLocaleString();
}

export default function OrderBookCard({ symbol }: { symbol: string }) {
    const capabilities = getInstrumentCapabilities(symbol);
    const meta = identifyMarketAndCode(symbol);
    const supported = capabilities.depth || capabilities.ticks;
    const resource = useMarketResource<Level1OrderBook | null>({
        key: `book:${symbol}`, enabled: supported, intervalMs: 10_000,
        loader: async () => {
            const data = await getLevel1OrderBook(symbol);
            if (!data) throw new Error('盘口数据暂不可用');
            return data;
        },
    });
    const book = resource.data;
    const [tab, setTab] = useState<ViewTab>('both');
    const unitLabel = meta.market === 'cn' ? '手（100股）' : meta.market === 'tw' ? '张（1000股）' : '股';
    const volumeUnit = meta.market === 'cn' ? 100 : meta.market === 'tw' ? 1000 : 1;
    const displayVolume = (value: number) => `${value < 0 ? '-' : ''}${formatTierVol(Math.abs(value) / volumeUnit)}`;
    if (!book) return (
        <Panel title="五档盘口与逐笔明细" sub="盘口与成交明细 · 数据按来源可用性展示">
            <div className="flex h-64 items-center justify-center text-xs text-faint" role="status">
                {!supported ? '当前标的暂不支持五档盘口与逐笔成交' : resource.loading ? '正在加载盘口与逐笔明细...' : resource.error && resource.error.message !== '盘口数据暂不可用' ? '盘口请求失败，稍后自动重试' : '暂无盘口与逐笔数据，稍后自动重试'}
            </div>
        </Panel>
    );

    const { bids, asks, orderRatio, orderDelta, outer, inner, limitUp, limitDown, currency, ticks = [], market } = book;
    const maxTierVol = Math.max(...bids.map((b) => b.volume), ...asks.map((a) => a.volume), 1);

    // Asks displayed from 卖5 down to 卖1
    const reversedAsks = [...asks].reverse();
    const bigOrderThreshold = market === 'cn' ? 10000 : market === 'tw' ? 50000 : 10000;

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
            sub={`${book.source} · ${book.asOf ? `截至 ${book.asOf}` : '源时间未提供'} · 单位：${unitLabel}`}
            action={action}
        >
            <div className="flex flex-col gap-3 p-3.5 text-xs">
                {resource.stale && <p className="text-faint" role="status">更新失败，保留上次数据</p>}
                {/* 委比、委差、内外盘、涨跌停核心数据栏 */}
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-page/40 p-2 border border-line">
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">委比:</span>
                        <strong className={`mono font-semibold ${orderRatio == null ? 'text-faint' : orderRatio >= 0 ? 'text-up' : 'text-down'}`}>
                            {orderRatio == null ? '—' : `${orderRatio > 0 ? '+' : ''}${orderRatio.toFixed(2)}%`}
                        </strong>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">委差:</span>
                        <strong className={`mono font-semibold ${orderDelta == null ? 'text-faint' : orderDelta >= 0 ? 'text-up' : 'text-down'}`}>
                            {orderDelta == null ? '—' : `${orderDelta > 0 ? '+' : ''}${displayVolume(orderDelta)}`}
                        </strong>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">外盘(主动买):</span>
                        <strong className="mono font-semibold text-up">{outer == null ? '—' : displayVolume(outer)}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">内盘(主动卖):</span>
                        <strong className="mono font-semibold text-down">{inner == null ? '—' : displayVolume(inner)}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">涨停价:</span>
                        <strong className="mono font-semibold text-up">{limitUp == null ? '—' : formatPrice(limitUp, currency)}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-faint text-[11px]">跌停价:</span>
                        <strong className="mono font-semibold text-down">{limitDown == null ? '—' : formatPrice(limitDown, currency)}</strong>
                    </div>
                </div>

                {(tab === 'both' || tab === 'book') && (!capabilities.depth || (!bids.length && !asks.length)) && <p className="text-faint">{capabilities.depth ? '暂无五档盘口数据' : '当前标的不支持五档盘口'}</p>}
                {(tab === 'both' || tab === 'ticks') && (!capabilities.ticks || !ticks.length) && <p className="text-faint">{capabilities.ticks ? '暂无逐笔成交数据' : '当前标的不支持逐笔成交'}</p>}
                {/* 1. 五档买卖盘口列表 */}
                {(tab === 'both' || tab === 'book') && capabilities.depth && (bids.length > 0 || asks.length > 0) && (
                    <div className="flex flex-col gap-0.5">
                        {/* 卖五至卖一 */}
                        {reversedAsks.map((ask) => {
                            const tierNum = ask.level;
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
                                        {displayVolume(ask.volume)}
                                    </span>
                                </div>
                            );
                        })}

                        {/* 最新现价基准分割线 */}
                        <div className="my-1 flex items-center justify-between border-y border-line-strong py-1 px-2 bg-page/60">
                            <span className="text-[11px] font-medium text-foreground">{book.priceBasis === 'previous-close' ? '昨收参考价（暂无最新成交）' : '最新成交'}</span>
                            <div className="flex items-center gap-2">
                                <span className={`mono text-sm font-bold ${book.change == null ? 'text-faint' : book.change >= 0 ? 'text-up' : 'text-down'}`}>
                                    {formatPrice(book.latestPrice, currency)}
                                </span>
                                <span className={`mono text-xs font-semibold ${book.changePercent == null ? 'text-faint' : book.changePercent >= 0 ? 'text-up' : 'text-down'}`}>
                                    {book.changePercent == null ? '—' : `${book.changePercent > 0 ? '+' : ''}${book.changePercent.toFixed(2)}%`}
                                </span>
                            </div>
                        </div>

                        {/* 买一至买五 */}
                        {bids.map((bid) => {
                            const tierNum = bid.level;
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
                                        {displayVolume(bid.volume)}
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
                            <span className="font-semibold text-foreground">{book.tickKind === 'snapshot' ? '最近一笔成交快照（非逐笔历史）' : '分时逐笔成交明细'}</span>
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
                                        <span className={`font-semibold ${book.prevClose == null || book.prevClose <= 0 ? 'text-faint' : t.price >= book.prevClose ? 'text-up' : 'text-down'}`}>
                                            {t.price.toFixed(2)}
                                        </span>
                                        <span className="flex items-center justify-end gap-1 w-20 text-right">
                                            {isBig && <span role="img" aria-label="大额成交" title="大额成交"><Flame aria-hidden="true" className="size-3 text-amber-400 shrink-0" /></span>}
                                            <span className="text-foreground">{displayVolume(t.volume)}</span>
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
