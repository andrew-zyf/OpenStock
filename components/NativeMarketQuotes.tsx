import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import ChangePill from '@/components/ChangePill';
import { getLiveQuotes } from '@/lib/actions/finnhub.actions';
import { tvToAppSymbol, formatPrice } from '@/lib/utils';
import type { Market } from '@/lib/markets';

// Native Market Quotes Table: Zero-delay Level-1 real-time quotes grouped by industry
// Clicking any asset opens it directly inside OpenStock (/stocks/[symbol]), never on a 3rd party site
export async function NativeMarketQuotesTable({ market }: { market: Market }) {
    const rawTvSymbols = market.groups.flatMap((g) => g.symbols.map(([s]) => s));
    const appSymbols = [...new Set(rawTvSymbols.map(tvToAppSymbol))];
    const quotes = await getLiveQuotes(appSymbols);

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
                <thead>
                    <tr className="border-b border-line text-left text-faint">
                        <th className="px-3 py-2 font-medium">标的资产</th>
                        <th className="px-3 py-2 text-right font-medium">最新价</th>
                        <th className="px-3 py-2 text-right font-medium">涨跌额</th>
                        <th className="px-3 py-2 text-right font-medium">涨跌幅</th>
                        <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">今开 / 昨收</th>
                        <th className="hidden px-3 py-2 text-right font-medium md:table-cell">日内最高 / 最低</th>
                    </tr>
                </thead>
                {market.groups.map((group) => (
                    <tbody key={group.title}>
                        <tr>
                            <td colSpan={6} className="kicker px-3 pt-3.5 pb-1 text-xs font-semibold text-brand-ink">
                                {group.title}
                            </td>
                        </tr>
                        {group.symbols.map(([tvSymbol, name]) => {
                            const appSymbol = tvToAppSymbol(tvSymbol);
                            const q = quotes[appSymbol];
                            const currency = q?.currency || (market.id === 'cn' ? 'CNY' : market.id === 'hk' ? 'HKD' : market.id === 'tw' ? 'TWD' : 'USD');
                            const isUp = (q?.d ?? 0) >= 0;
                            const sign = (q?.d ?? 0) > 0 ? '+' : '';

                            return (
                                <tr key={tvSymbol} className="border-t border-line/50 transition-colors hover:bg-hover/50">
                                    <td className="px-3 py-2.5">
                                        <Link href={`/stocks/${appSymbol}`} className="group flex items-baseline gap-2 font-semibold">
                                            <span className="text-foreground transition-colors group-hover:text-brand-ink">{name}</span>
                                            <span className="mono text-[11px] text-faint">{appSymbol}</span>
                                        </Link>
                                    </td>
                                    <td className="num px-3 py-2.5 text-right font-semibold text-foreground">
                                        {q?.c ? formatPrice(q.c, currency) : '—'}
                                    </td>
                                    <td className={`num px-3 py-2.5 text-right font-medium ${isUp ? 'text-up' : 'text-down'}`}>
                                        {q?.d != null ? `${sign}${q.d.toFixed(2)}` : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                        <ChangePill value={q?.dp} />
                                    </td>
                                    <td className="num hidden px-3 py-2.5 text-right text-xs text-faint sm:table-cell">
                                        {q?.o ? formatPrice(q.o, currency) : '—'} / {q?.pc ? formatPrice(q.pc, currency) : '—'}
                                    </td>
                                    <td className="num hidden px-3 py-2.5 text-right text-xs text-faint md:table-cell">
                                        {q?.h ? formatPrice(q.h, currency) : '—'} / {q?.l ? formatPrice(q.l, currency) : '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                ))}
            </table>
            <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11.5px] text-faint">
                <span>{market.name}核心蓝筹资产 · 点击标的即可在本站查看实时分时走势</span>
                <span className="mono">支持 15 秒实时轮询</span>
            </div>
        </div>
    );
}

// Native Market Movers: Biggest gainers / losers across the market
// Clicking any asset opens it directly inside OpenStock (/stocks/[symbol])
export async function NativeMarketMovers({ market, count = 8 }: { market: Market; count?: number }) {
    const rawTvSymbols = market.groups.flatMap((g) => g.symbols.map(([s]) => s));
    const nameMap = Object.fromEntries(market.groups.flatMap((g) => g.symbols.map(([s, n]) => [tvToAppSymbol(s), n])));
    const appSymbols = [...new Set(rawTvSymbols.map(tvToAppSymbol))];
    const quotes = await getLiveQuotes(appSymbols);

    const ranked = appSymbols
        .flatMap((sym) => (quotes[sym]?.c ? [{ symbol: sym, name: nameMap[sym] || sym, quote: quotes[sym]! }] : []))
        .sort((a, b) => Math.abs(b.quote.dp ?? 0) - Math.abs(a.quote.dp ?? 0))
        .slice(0, count);

    const maxAbs = Math.max(0.01, ...ranked.map((r) => Math.abs(r.quote.dp ?? 0)));

    if (ranked.length === 0) return <p className="p-4 text-center text-xs text-faint">暂无行情数据。</p>;

    return (
        <ul className="flex flex-col gap-1 p-1">
            {ranked.map(({ symbol, name, quote }) => {
                const up = (quote.dp ?? 0) >= 0;
                const currency = quote.currency || (market.id === 'cn' ? 'CNY' : market.id === 'hk' ? 'HKD' : market.id === 'tw' ? 'TWD' : 'USD');
                return (
                    <li key={symbol}>
                        <Link href={`/stocks/${symbol}`} className="flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors hover:bg-hover/60">
                            <span className={up ? 'text-up' : 'text-down'}>
                                {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13.5px] font-semibold text-foreground">{name}</span>
                                <span className="mono block text-[11.5px] text-faint">{symbol}</span>
                            </span>
                            <span className="num text-xs font-semibold text-foreground">
                                {formatPrice(quote.c, currency)}
                            </span>
                            <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-hover">
                                <span
                                    className={`absolute inset-y-0 rounded-full ${up ? 'left-0 bg-up' : 'right-0 bg-down'}`}
                                    style={{ width: `${(Math.abs(quote.dp ?? 0) / maxAbs) * 100}%` }}
                                />
                            </span>
                            <ChangePill value={quote.dp} />
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
