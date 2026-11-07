'use server';

import { identifyMarketAndCode, type MarketType } from '@/lib/market/instrument';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { amount, fetchProviderJson, isoDate, numeric, percentage, perShare, record, records, text } from '@/lib/market/financials';

export type FinancialMetricRow = {
    reportDate: string;
    reportType: string;
    periodBasis?: string;
    currency?: string;
    rocYear?: number;
    profitLabel?: '归母净利润' | '净利润';
    revenue?: string;
    revenueYoy?: string;
    netProfit?: string;
    netProfitYoy?: string;
    eps?: string;
    bps?: string;
    roe?: string;
    grossMargin?: string;
    netMargin?: string;
    debtRatio?: string;
};

export type FinancialSummaryData = {
    symbol: string;
    market: MarketType;
    source: string;
    rows: FinancialMetricRow[];
};

export async function getNativeFinancials(rawSymbol: string): Promise<FinancialSummaryData | null> {
    const meta = identifyMarketAndCode(rawSymbol);
    const sym = meta.normalizedSymbol.toUpperCase();
    if (!getInstrumentCapabilities(rawSymbol).financials) return null;

    if (meta.market === 'cn' && (sym.endsWith('.SS') || sym.endsWith('.SZ'))) {
        const code = `${sym.endsWith('.SS') ? 'SH' : 'SZ'}${sym.split('.')[0]}`;
        const json = record(await fetchProviderJson(`https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${code}`));
        const rows = records(json?.data).filter((item) => text(item.REPORT_DATE_NAME) || text(item.REPORT_DATE)).slice(0, 4).map((item): FinancialMetricRow => ({
            reportDate: text(item.REPORT_DATE_NAME) || text(item.REPORT_DATE)!.slice(0, 10),
            reportType: text(item.REPORT_TYPE) || '定期报告',
            periodBasis: '年初至报告期末（累计）',
            currency: 'CNY',
            profitLabel: '归母净利润',
            revenue: amount(item.TOTALOPERATEREVE, 'CNY'),
            revenueYoy: percentage(item.TOTALOPERATEREVETZ),
            netProfit: amount(item.PARENTNETPROFIT, 'CNY'),
            netProfitYoy: percentage(item.PARENTNETPROFITTZ),
            eps: perShare(item.EPSJB, 'CNY'),
            bps: perShare(item.BPS, 'CNY'),
            roe: percentage(item.ROEJQ),
            grossMargin: percentage(item.XSMLL),
            netMargin: percentage(item.XSJLL),
            debtRatio: percentage(item.ZCFZL),
        }));
        return rows.length ? { symbol: sym, market: 'cn', source: '东方财富 F10', rows } : null;
    }

    if (meta.market === 'hk') {
        const secucode = `${sym.replace(/\.HK$/, '').padStart(5, '0')}.HK`;
        const json = record(await fetchProviderJson(`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_FN_MAININDICATOR&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)&pageNumber=1&pageSize=4&sortTypes=-1&sortColumns=STD_REPORT_DATE`));
        const rows = records(record(json?.result)?.data)
            .filter((item) => (!item.SECUCODE || item.SECUCODE === secucode) && (isoDate(item.REPORT_DATE) || isoDate(item.STD_REPORT_DATE) || text(item.REPORT_TYPE)))
            .slice(0, 4).map((item): FinancialMetricRow => {
                const currency = text(item.CURRENCY)?.toUpperCase();
                const start = isoDate(item.START_DATE);
                // STD_REPORT_DATE is calendar-normalized and can differ from the actual fiscal end.
                const end = isoDate(item.REPORT_DATE) || isoDate(item.STD_REPORT_DATE);
                return {
                    reportDate: end || text(item.REPORT_TYPE)!,
                    reportType: text(item.REPORT_TYPE) || '定期报告',
                    periodBasis: start && end && start <= end ? `${start} 至 ${end}` : undefined,
                    currency,
                    profitLabel: '归母净利润',
                    revenue: amount(item.OPERATE_INCOME, currency),
                    revenueYoy: percentage(item.OPERATE_INCOME_YOY),
                    netProfit: amount(item.HOLDER_PROFIT, currency),
                    netProfitYoy: percentage(item.HOLDER_PROFIT_YOY),
                    eps: perShare(item.BASIC_EPS, currency),
                    bps: perShare(item.BPS, currency),
                    roe: percentage(item.ROE_AVG),
                    grossMargin: percentage(item.GROSS_PROFIT_RATIO),
                    netMargin: percentage(item.NET_PROFIT_RATIO),
                    debtRatio: percentage(item.DEBT_ASSET_RATIO),
                };
            });
        return rows.length ? { symbol: sym, market: 'hk', source: '东方财富港股 F10（币种依数据源）', rows } : null;
    }

    // The _L dataset covers TWSE-listed companies, not TPEx companies.
    if (meta.market === 'tw' && sym.endsWith('.TW')) {
        const code = sym.replace(/\.TW$/, '');
        const list = records(await fetchProviderJson('https://openapi.twse.com.tw/v1/opendata/t187ap14_L'));
        const rows = list.filter((item) => text(item['公司代號']) === code).flatMap((item): FinancialMetricRow[] => {
            const rocYear = numeric(item['年度']);
            const quarter = numeric(item['季別']);
            if (rocYear === undefined || !Number.isInteger(rocYear) || rocYear <= 0 || rocYear >= 1000
                || quarter === undefined || ![1, 2, 3, 4].includes(quarter)) return [];
            const revenue = numeric(item['營業收入']);
            const attributable = numeric(item['歸屬於母公司業主之淨利（淨損）'])
                ?? numeric(item['歸屬於母公司業主之淨利(淨損)']);
            const netProfit = numeric(item['稅後淨利']);
            return [{
                reportDate: `${rocYear + 1911}年第${quarter}季（民国${rocYear}年）`,
                reportType: quarter === 4 ? '年报' : quarter === 2 ? '中报' : `第${quarter}季报`,
                periodBasis: '年初至报告季末（累计）',
                rocYear,
                currency: 'TWD',
                profitLabel: attributable !== undefined ? '归母净利润' : '净利润',
                revenue: amount(revenue, 'TWD', 1000),
                netProfit: amount(attributable ?? netProfit, 'TWD', 1000),
                eps: perShare(item['基本每股盈餘(元)'], 'TWD'),
                // Total net profit/revenue is a net margin; neither ROE nor gross margin is supplied.
                netMargin: revenue !== undefined && revenue !== 0 && netProfit !== undefined
                    ? percentage(netProfit / revenue * 100) : undefined,
            }];
        }).slice(0, 4);
        return rows.length ? { symbol: sym, market: 'tw', source: '台湾证券交易所 OpenAPI t187ap14_L', rows } : null;
    }

    return null;
}
