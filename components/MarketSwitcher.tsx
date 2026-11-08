'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { MARKETS, MARKET_COOKIE, getMarketSession, type MarketId } from "@/lib/markets";
import { cn } from "@/lib/utils";

// Market chips for the dashboard. The choice is remembered in a cookie so the server renders it next time.
export default function MarketSwitcher({ active, openIds }: { active: MarketId; openIds: MarketId[] }) {
    // Compute after hydration so server/client clocks cannot change the initial markup.
    const [now, setNow] = useState<Date | null>(null);
    useEffect(() => {
        const update = () => setNow(new Date());
        update();
        const timer = setInterval(update, 30_000);
        return () => clearInterval(timer);
    }, []);
    const remember = (id: MarketId) => {
        document.cookie = `${MARKET_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    };

    return (
        <nav aria-label="市场选择" className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {MARKETS.map((m) => {
                const selected = m.id === active;
                const session = now ? getMarketSession(m.id, now) : undefined;
                const open = session?.isTrading ?? openIds.includes(m.id);
                const status = session ? `${session.label}${session.calendarStatus === 'unverified' ? ' · 日历未核验' : ''}` : '计划时段待确认';
                return (
                    <Link
                        key={m.id}
                        href={`/dashboard?market=${m.id}`}
                        onClick={() => remember(m.id)}
                        aria-current={selected ? 'page' : undefined}
                        aria-label={`${m.name} · ${status}`}
                        title={`${status} · ${m.timeZone}${session ? ` · ${session.exchangeDate}` : ''}`}
                        className={cn(
                            'flex h-9 flex-none items-center gap-2 rounded-full px-3.5 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150',
                            selected
                                ? 'bg-brand-soft text-brand-ink shadow-[inset_0_0_0_1px_oklch(0.8_0.13_176/0.45)]'
                                : 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover hover:text-foreground',
                        )}
                    >
                        <span aria-hidden="true" className={cn('size-1.5 rounded-full', open ? 'bg-up' : 'bg-line-strong')} />
                        {m.name}
                        {selected && session && <span className="text-[11px] font-normal">{status}</span>}
                    </Link>
                );
            })}
        </nav>
    );
}
