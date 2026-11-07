import { Suspense } from "react";
import { Plus } from "lucide-react";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import DataFreshness from "@/components/DataFreshness";
import YahooStockChart from "@/components/stocks/YahooStockChart";
import { getMarket } from "@/lib/markets";
import { cn } from "@/lib/utils";

// The real app chrome with live multi-market data. Used on the landing and auth pages,
// so marketing never shows a stale screenshot or blocked 3rd-party widget.
export default function ProductPreview() {
    const cnMarket = getMarket('cn');
    return (
        <div className="overflow-hidden rounded-[18px] bg-side p-[3px] shadow-[0_0_0_1px_oklch(1_0_0/0.05),0_30px_80px_oklch(0_0_0/0.55)]">
            <div className="flex items-end gap-1 px-3 pt-2" aria-hidden>
                {[['市场概览', true], ['600519.SS', false], ['00700.HK', false], ['2330.TW', false], ['NVDA', false]].map(([label, active]) => (
                    <span
                        key={label as string}
                        className={cn('flex h-9 min-w-[104px] items-center rounded-t-xl px-4 font-semibold', active ? 'bg-canvas text-foreground' : 'text-faint', label !== '市场概览' && 'mono text-[13px]')}
                    >
                        {label}
                    </span>
                ))}
                <span className="chrome-btn"><Plus /></span>
            </div>
            <div className="flex flex-col gap-3 rounded-[15px] bg-canvas p-3 md:p-4">
                <section className="hatch">
                    <div className="section-head">
                        <div>
                            <h3 className="section-title">核心指数</h3>
                            <p className="section-sub">美股 · A股 · 港股 · 台股 毫秒级原生实时行情</p>
                        </div>
                        <DataFreshness />
                    </div>
                    <Suspense fallback={<PulseSkeleton />}>
                        <IndexPulse market={cnMarket} />
                    </Suspense>
                </section>
                <div className="grid gap-3">
                    <YahooStockChart symbol="600519.SS" />
                </div>
            </div>
        </div>
    );
}
