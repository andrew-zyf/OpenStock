import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NativeFinancials from '@/components/stocks/NativeFinancials';
import NativeCompanyProfile from '@/components/stocks/NativeCompanyProfile';

vi.mock('@/components/Panel', () => ({
    default: ({ title, sub, children }: { title: string; sub: React.ReactNode; children: React.ReactNode }) => (
        <section><h2>{title}</h2><p>{sub}</p>{children}</section>
    ),
}));

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

const forbiddenClaims = ['标准无保留', '按期规范披露', '官方核定', '官方监管披露', '+12.40%', '+15.80%'];

describe('native financial/profile rendering', () => {
    it('renders honest empty financial and profile states after provider failure', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        const finance = renderToStaticMarkup(await NativeFinancials({ symbol: '2330.TW' }));
        const profile = renderToStaticMarkup(await NativeCompanyProfile({ symbol: '2330.TW' }));
        expect(finance).toContain('暂未取得可用财务数据');
        expect(profile).toContain('暂未取得公司简介');
        expect(profile).not.toContain('主营业务与经营范围');
        for (const claim of forbiddenClaims) expect(finance + profile).not.toContain(claim);
        expect(finance).not.toContain('TWD');
    });

    it('renders zero values and missing ratios without inventing financial conclusions', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => [{ '公司代號': '2330', '年度': '114', '季別': '2',
            '營業收入': '0', '稅後淨利': '0', '基本每股盈餘(元)': '0' }] });
        const html = renderToStaticMarkup(await NativeFinancials({ symbol: '2330.TW' }));
        expect(html).toContain('0.00台币');
        expect(html).toContain('2025年第2季（民国114年）');
        expect(html).toContain('年初至报告季末（累计）');
        expect(html).toContain('净利润');
        expect(html).not.toContain('归母净利润');
        expect(html).toContain('同比: —');
        expect(html).toContain('>—</span>');
        for (const claim of forbiddenClaims) expect(html).not.toContain(claim);
    });

    it('displays HK source currency as USD without a listing-currency label', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { data: [{
            REPORT_TYPE: '2025年报', STD_REPORT_DATE: '2025-12-31', CURRENCY: 'USD', OPERATE_INCOME: 100000000,
        }] } }) });
        const html = renderToStaticMarkup(await NativeFinancials({ symbol: '00981.HK' }));
        expect(html).toContain('1.00亿美元');
        expect(html).toContain('报表币种：USD');
        expect(html).not.toContain('港元');
        expect(html).not.toContain('HKD');
    });

    it('renders actual fiscal report dates and omits reversed HK source ranges', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { data: [{
            SECUCODE: '09988.HK', REPORT_TYPE: '2026年一季报', STD_REPORT_DATE: '2026-03-31',
            REPORT_DATE: '2026-06-30', START_DATE: '2026-04-01', FISCAL_YEAR: '3-31', CURRENCY: 'HKD',
        }] } }) });
        const valid = renderToStaticMarkup(await NativeFinancials({ symbol: '09988.HK' }));
        expect(valid).toContain('2026-04-01 至 2026-06-30');
        expect(valid).not.toContain('2026-04-01 至 2026-03-31');
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { data: [{
            SECUCODE: '09988.HK', REPORT_TYPE: '2026年一季报', STD_REPORT_DATE: '2026-03-31',
            START_DATE: '2026-04-01', FISCAL_YEAR: '3-31', CURRENCY: 'HKD',
        }] } }) });
        const invalid = renderToStaticMarkup(await NativeFinancials({ symbol: '09988.HK' }));
        expect(invalid).toContain('期间口径：数据源未提供');
        expect(invalid).not.toContain('2026-04-01 至 2026-03-31');
    });

    it.each(['000001.SS', '0050.TW', '6488.TWO', '430047.BJ'])('renders unsupported corporate panels without fetching for %s', async (symbol) => {
        const html = renderToStaticMarkup(await NativeFinancials({ symbol }))
            + renderToStaticMarkup(await NativeCompanyProfile({ symbol }));
        expect(html).toContain('不支持公司');
        expect(fetchMock).not.toHaveBeenCalled();
        for (const claim of forbiddenClaims) expect(html).not.toContain(claim);
    });
});
