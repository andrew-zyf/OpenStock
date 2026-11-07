'use client';

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CANDLE_CHART_WIDGET_CONFIG } from "@/lib/constants";

// The free embed can't save indicators added inside it, so the ones picked here are kept per browser and
// passed in as `studies` on every chart. Each id was checked on a live advanced-chart embed.
const INDICATORS = [
    { id: 'STD;SMA', label: '简单移动平均 (SMA)' },
    { id: 'STD;EMA', label: '指数移动平均 (EMA)' },
    { id: 'STD;Bollinger_Bands', label: '布林带 (Bollinger Bands)' },
    { id: 'STD;VWAP', label: '成交量加权均价 (VWAP)' },
    { id: 'STD;RSI', label: '相对强弱指标 (RSI)' },
    { id: 'STD;MACD', label: '平滑异同移动平均线 (MACD)' },
    { id: 'STD;Stochastic', label: '随机震荡指标 (KD)' },
    { id: 'STD;Average_True_Range', label: '真实波动幅度 (ATR)' },
];
const STORAGE_KEY = 'openstock:chart-indicators';
const CHART_HEIGHT = 560;

const readSaved = (): string[] => {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return Array.isArray(saved) ? INDICATORS.map((i) => i.id).filter((id) => saved.includes(id)) : [];
    } catch {
        return [];
    }
};

export default function StockChart({ tvSymbol, scriptUrl }: { tvSymbol: string; scriptUrl: string }) {
    // null until the browser's saved list is read, so the chart mounts once with the right indicators
    const [studies, setStudies] = useState<string[] | null>(null);
    useEffect(() => setStudies(readSaved()), []);

    const toggle = (id: string) => {
        const current = studies ?? [];
        const next = INDICATORS.map((i) => i.id).filter((i) => (i === id ? !current.includes(id) : current.includes(i)));
        setStudies(next);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode: still applies for this visit */ }
    };

    const menu = (
        <DropdownMenu>
            <DropdownMenuTrigger className="btn btn-ghost h-8 px-2.5 text-[13px]" disabled={!studies}>
                <SlidersHorizontal /> 技术指标{studies?.length ? <span className="num text-faint">{studies.length}</span> : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[12px] font-normal text-faint">当前浏览器将自动保持所选指标</DropdownMenuLabel>
                {INDICATORS.map(({ id, label }) => (
                    <DropdownMenuCheckboxItem key={id} checked={studies?.includes(id) ?? false} onCheckedChange={() => toggle(id)} onSelect={(e) => e.preventDefault()}>
                        {label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    return (
        <Panel title="K 线图表" sub="行情源自 TradingView · 可在图表工具栏中切换周期与样式" action={menu}>
            {studies ? (
                <TradingViewWidget scriptUrl={scriptUrl} config={{ ...CANDLE_CHART_WIDGET_CONFIG(tvSymbol), studies }} height={CHART_HEIGHT} allowExpand />
            ) : (
                <div className="tv-frame" style={{ height: CHART_HEIGHT }} />
            )}
        </Panel>
    );
}
