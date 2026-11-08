'use client';

import { CalendarClock, Gauge, Landmark, MoveVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStockQuote } from '@/components/stocks/StockLivePrice';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { formatNumber, formatPrice } from '@/lib/utils';

export default function StockQuoteStats({ symbol, layout, children }: { symbol: string; layout: 'native' | 'us'; children?: ReactNode }) {
    const { quote, currency } = useStockQuote();
    const meta = identifyMarketAndCode(symbol);
    const money = (value?: number) => value != null && Number.isFinite(value) ? formatPrice(value, currency) : '—';
    const percent = (value?: number) => value != null && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
    const volume = (shares?: number) => {
        if (shares == null || !Number.isFinite(shares)) return '—';
        const divisor = meta.market === 'cn' ? 100 : meta.market === 'tw' ? 1000 : 1;
        const unit = meta.market === 'cn' ? '手（100股）' : meta.market === 'tw' ? '张（1000股）' : '股';
        const count = shares / divisor;
        const formatted = count < 10000 ? count.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : formatNumber(count);
        return `${formatted}${unit}`;
    };
    const amplitude = quote?.amplitude ?? (quote?.h != null && quote?.l != null && quote?.pc != null && quote.pc > 0
        ? (quote.h - quote.l) / quote.pc * 100 : undefined);
    const stats = [
        { label: '今开', icon: CalendarClock, value: money(quote?.o), hint: '今日开盘价' },
        { label: '昨收', icon: Gauge, value: money(quote?.pc), hint: '上一交易日收盘价' },
        { label: '最高', icon: MoveVertical, value: money(quote?.h), hint: '今日最高价', valueClass: 'text-up' },
        { label: '最低', icon: MoveVertical, value: money(quote?.l), hint: '今日最低价', valueClass: 'text-down' },
        { label: '成交量', icon: Landmark, value: volume(quote?.volume), hint: '今日累计成交量' },
        { label: '成交额', icon: Landmark, value: quote?.turnover != null && Number.isFinite(quote.turnover) ? `${quote.turnover === 0 ? '0' : formatNumber(quote.turnover)} ${currency}` : '—', hint: '今日累计成交金额' },
        { label: '换手率', icon: Gauge, value: percent(quote?.turnoverRate), hint: meta.market === 'tw' ? '当次成交量 / 独立公司股本参考' : '筹码换手活跃度' },
        { label: layout === 'native' ? '振幅' : '日内振幅', icon: MoveVertical, value: percent(amplitude), hint: '当次行情最高、最低与昨收口径' },
    ];

    return <>
        <p className="mt-2 text-[12px] text-faint">量价统计与上方报价同次刷新；来源未提供的字段显示 —。</p>
        <div className={layout === 'native' ? 'card mt-[3px] grid grid-cols-2 gap-2 p-3 sm:grid-cols-5' : 'bento mt-[3px]'}>
            {stats.map(({ label, icon: Icon, value, hint, valueClass }) => layout === 'native' ? (
                <div key={label} className="flex flex-col gap-1 rounded-[10px] bg-page/50 p-2.5" title={hint}>
                    <span className="flex items-center gap-1.5 text-[12px] text-faint"><Icon className="size-3.5 text-muted-foreground" /> {label}</span>
                    <span className={`num truncate text-[15px] font-semibold ${value === '—' ? 'text-faint' : valueClass || 'text-foreground'}`}>{value}</span>
                </div>
            ) : (
                <div key={label} className="bento-tile gap-2.5">
                    <div className="bento-head"><span className="bento-ico"><Icon /></span>{label}</div>
                    <p className="num truncate text-[17px] font-bold tracking-[-0.02em]">{value}</p>
                    <p className="text-[12px] text-faint">{hint}</p>
                </div>
            ))}
            {children}
        </div>
    </>;
}
