'use server';

import { identifyMarketAndCode, type MarketType } from "@/lib/realtime-market";

export type FinancialMetricRow = {
    reportDate: string;
    reportType: string;
    revenue: string;
    revenueYoy: string;
    netProfit: string;
    netProfitYoy: string;
    eps: string;
    bps: string;
    roe: string;
    grossMargin: string;
    netMargin: string;
    debtRatio: string;
};

export type FinancialSummaryData = {
    symbol: string;
    market: MarketType;
    rows: FinancialMetricRow[];
};

export async function getNativeFinancials(rawSymbol: string): Promise<FinancialSummaryData | null> {
    const meta = identifyMarketAndCode(rawSymbol);
    const sym = meta.normalizedSymbol.toUpperCase();

    // 1. A-Shares: Direct EastMoney NewFinanceAnalysis API
    if (meta.market === 'cn') {
        try {
            const num = sym.replace(/\.(SS|SZ)$/, '');
            const prefix = sym.endsWith('.SS') || num.startsWith('6') || num.startsWith('9') ? 'SH' : 'SZ';
            const code = `${prefix}${num}`;
            const res = await fetch(`https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${code}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                next: { revalidate: 86400 },
            });
            if (res.ok) {
                const j = await res.json();
                const list = j?.data || [];
                const rows: FinancialMetricRow[] = list.slice(0, 4).map((item: Record<string, unknown>) => {
                    const toBillion = (val: unknown) => {
                        const n = Number(val);
                        if (!n) return '—';
                        if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿元`;
                        if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万元`;
                        return `${n.toFixed(2)}元`;
                    };

                    const toPct = (val: unknown) => {
                        const n = Number(val);
                        if (val == null || !Number.isFinite(n)) return '—';
                        return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
                    };

                    return {
                        reportDate: String(item.REPORT_DATE_NAME || item.REPORT_DATE || '').slice(0, 10),
                        reportType: String(item.REPORT_TYPE || '定期报告'),
                        revenue: toBillion(item.TOTALOPERATEREVE),
                        revenueYoy: toPct(item.TOTALOPERATEREVETZ),
                        netProfit: toBillion(item.PARENTNETPROFIT),
                        netProfitYoy: toPct(item.PARENTNETPROFITTZ),
                        eps: item.EPSJB != null ? `${Number(item.EPSJB).toFixed(2)}元` : '—',
                        bps: item.BPS != null ? `${Number(item.BPS).toFixed(2)}元` : '—',
                        roe: toPct(item.ROEJQ),
                        grossMargin: toPct(item.XSMLL),
                        netMargin: toPct(item.XSJLL),
                        debtRatio: toPct(item.ZCFZL),
                    };
                });

                if (rows.length) {
                    return { symbol: sym, market: 'cn', rows };
                }
            }
        } catch (e) {
            console.error('EastMoney financials fetch error', e);
        }
    }

    return null;
}
