import Link from 'next/link';
import { LineChart, Globe } from 'lucide-react';
import ChangePill from '@/components/ChangePill';
import { getLiveQuotes } from '@/lib/actions/finnhub.actions';
import { formatPrice } from '@/lib/utils';
import type { MarketId } from '@/lib/markets';

const CROSS_MARKET_SYMBOLS = [
    { marketId: 'us' as MarketId, marketName: '美股', symbol: 'SPY', label: '标普 500 ETF', currency: 'USD' },
    { marketId: 'cn' as MarketId, marketName: 'A股', symbol: '000001.SS', label: '上证指数', currency: 'CNY', isIndex: true },
    { marketId: 'hk' as MarketId, marketName: '港股', symbol: '02800.HK', label: '盈富基金（恒指 ETF）', currency: 'HKD' },
    { marketId: 'tw' as MarketId, marketName: '台股', symbol: '0050.TW', label: '元大台湾50', currency: 'TWD' },
];

export default async function CrossMarketBar({ activeMarketId }: { activeMarketId: MarketId }) {
    const symbols = CROSS_MARKET_SYMBOLS.map((item) => item.symbol);
    const quotes = await getLiveQuotes(symbols);

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-faint">
                    <Globe className="size-3.5 text-brand-ink" />
                    <span>四地联动速览 (美股 · A股 · 港股 · 台股)</span>
                </div>
                <span className="mono text-[11px] text-faint">页面加载快照 · 点击查看本地详情</span>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {CROSS_MARKET_SYMBOLS.map(({ marketId, marketName, symbol, label, currency, isIndex }) => {
                    const q = quotes[symbol];
                    const isActive = activeMarketId === marketId;
                    const priceText = q?.c
                        ? isIndex
                            ? `${q.c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 点`
                            : formatPrice(q.c, currency)
                        : '—';

                    return (
                        <div
                            key={symbol}
                            className={`card relative flex flex-col justify-between p-3 transition-colors ${
                                isActive
                                    ? 'border-brand-ink/40 bg-brand-soft/20 ring-1 ring-brand-ink/30'
                                    : 'hover:bg-hover/60'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <Link
                                    href={`/dashboard?market=${marketId}`}
                                    className="flex items-center gap-1.5 text-xs font-bold text-foreground hover:text-brand-ink"
                                    title={`切换至${marketName}概览`}
                                >
                                    <span className="pill px-1.5 py-0.5 text-[10px] font-semibold bg-white/5">
                                        {marketName}
                                    </span>
                                    <span className="truncate">{label}</span>
                                </Link>
                                <Link
                                    href={`/stocks/${symbol}`}
                                    className="mono text-[11px] text-faint hover:text-brand-ink"
                                    title="查看该指数/ETF本地行情图表"
                                >
                                    {symbol}
                                </Link>
                            </div>

                            <div className="mt-2 flex items-baseline justify-between gap-2">
                                <Link
                                    href={`/stocks/${symbol}`}
                                    className="num text-base font-bold tracking-tight text-foreground hover:text-brand-ink"
                                >
                                    {priceText}
                                </Link>
                                <ChangePill value={q?.dp} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
