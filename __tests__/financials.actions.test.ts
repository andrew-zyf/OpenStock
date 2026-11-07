import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNativeFinancials } from '@/lib/actions/financials.actions';
import { fetchCompanyProfile } from '@/lib/company-profile';

const fetchMock = vi.fn();
const respond = (value: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => value });
const twRow = (extra: Record<string, unknown> = {}) => ({
    '公司代號': '1101', '年度': '114', '季別': '3', '營業收入': '1,000,000',
    '營業利益': '250000', '稅後淨利': '100000', '基本每股盈餘(元)': '1.25', ...extra,
});

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('financial source mapping', () => {
    it('maps a noncurated TWSE company with report year, cumulative basis and thousand-TWD amounts', async () => {
        respond([twRow()]);
        const result = await getNativeFinancials('1101.TW');
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('t187ap14_L'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(result?.rows[0]).toMatchObject({
            reportDate: '2025年第3季（民国114年）', rocYear: 114, periodBasis: '年初至报告季末（累计）',
            currency: 'TWD', revenue: '10.00亿台币', netProfit: '1.00亿台币', eps: '1.25台币',
            netMargin: '+10.00%', profitLabel: '净利润',
        });
        expect(result?.rows[0].roe).toBeUndefined();
        expect(result?.rows[0].grossMargin).toBeUndefined();
        expect(result?.rows[0].revenueYoy).toBeUndefined();
        expect(result?.rows[0].netProfitYoy).toBeUndefined();
    });

    it('always calls the official source for formerly curated 2330', async () => {
        respond([twRow({ '公司代號': '2330', '營業收入': '0', '稅後淨利': '0', '基本每股盈餘(元)': '0' })]);
        const row = (await getNativeFinancials('2330.TW'))?.rows[0];
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(row).toMatchObject({ revenue: '0.00台币', netProfit: '0.00台币', eps: '0.00台币' });
        expect(row?.netMargin).toBeUndefined();
    });

    it('prefers exact attributable profit, including zero, without changing total net margin', async () => {
        respond([twRow({ '歸屬於母公司業主之淨利（淨損）': '0' })]);
        expect((await getNativeFinancials('1101.TW'))?.rows[0]).toMatchObject({
            profitLabel: '归母净利润', netProfit: '0.00台币', netMargin: '+10.00%',
        });
    });

    it('does not turn absent or invalid metrics into zero', async () => {
        respond([twRow({ '營業收入': '', '稅後淨利': null, '基本每股盈餘(元)': '--' })]);
        const row = (await getNativeFinancials('1101.TW'))?.rows[0];
        expect(row).toBeDefined();
        expect(row?.revenue).toBeUndefined();
        expect(row?.netProfit).toBeUndefined();
        expect(row?.eps).toBeUndefined();
    });

    it.each(['USD', 'CNY', 'HKD'])('preserves HK report currency %s and exact reporting dates', async (currency) => {
        respond({ result: { data: [{ SECUCODE: '00981.HK', CURRENCY: currency, REPORT_TYPE: '2025年中报',
            STD_REPORT_DATE: '2025-06-30 00:00:00', START_DATE: '2025-01-01 00:00:00',
            OPERATE_INCOME: 100000000, HOLDER_PROFIT: 0, BASIC_EPS: 0, ROE_YEARLY: 55 }] } });
        const row = (await getNativeFinancials('981.HK'))?.rows[0];
        const unit = { USD: '美元', CNY: '人民币', HKD: '港元' }[currency];
        expect(row).toMatchObject({ currency, reportDate: '2025-06-30', reportType: '2025年中报',
            periodBasis: '2025-01-01 至 2025-06-30', revenue: `1.00亿${unit}`, netProfit: `0.00${unit}`, eps: `0.00${unit}` });
        expect(row?.roe).toBeUndefined();
    });

    it('uses actual HK fiscal reporting dates for April–March years instead of calendar-normalized dates', async () => {
        respond({ result: { data: [
            { SECUCODE: '09988.HK', REPORT_TYPE: '2026年一季报', FISCAL_YEAR: '3-31', CURRENCY: 'HKD',
                STD_REPORT_DATE: '2026-03-31 00:00:00', REPORT_DATE: '2026-06-30 00:00:00', START_DATE: '2026-04-01 00:00:00' },
            { SECUCODE: '09988.HK', REPORT_TYPE: '2025年年报', FISCAL_YEAR: '3-31', CURRENCY: 'HKD',
                STD_REPORT_DATE: '2025-12-31 00:00:00', REPORT_DATE: '2026-03-31 00:00:00', START_DATE: '2025-04-01 00:00:00' },
        ] } });
        const rows = (await getNativeFinancials('09988.HK'))?.rows;
        expect(rows?.[0]).toMatchObject({ reportDate: '2026-06-30', periodBasis: '2026-04-01 至 2026-06-30', reportType: '2026年一季报', currency: 'HKD' });
        expect(rows?.[1]).toMatchObject({ reportDate: '2026-03-31', periodBasis: '2025-04-01 至 2026-03-31', reportType: '2025年年报', currency: 'HKD' });
    });

    it.each(['2026-04-01', '2026-02-30', 'not-a-date'])('omits invalid or reversed source ranges without reconstructing a start year: %s', async (start) => {
        respond({ result: { data: [{ SECUCODE: '09988.HK', REPORT_TYPE: '来源报告标签', CURRENCY: 'HKD',
            STD_REPORT_DATE: '2026-03-31', START_DATE: start, FISCAL_YEAR: '3-31', OPERATE_INCOME: 0 }] } });
        const row = (await getNativeFinancials('09988.HK'))?.rows[0];
        expect(row).toMatchObject({ reportDate: '2026-03-31', reportType: '来源报告标签', revenue: '0.00港元', currency: 'HKD' });
        expect(row?.periodBasis).toBeUndefined();
    });

    it('does not infer HKD when reporting currency is absent', async () => {
        respond({ result: { data: [{ REPORT_TYPE: '2025年报', OPERATE_INCOME: 12 }] } });
        const row = (await getNativeFinancials('700.HK'))?.rows[0];
        expect(row?.currency).toBeUndefined();
        expect(row?.revenue).toBe('12.00（币种未提供）');
    });

    it('preserves genuine zero A-share metrics and routes SSE/SZSE separately', async () => {
        respond({ data: [{ REPORT_DATE: '2025-12-31', TOTALOPERATEREVE: 0, PARENTNETPROFIT: 0, ROEJQ: 0, EPSJB: 0 }] });
        expect((await getNativeFinancials('600519.SS'))?.rows[0]).toMatchObject({ revenue: '0.00人民币', netProfit: '0.00人民币', roe: '0.00%', eps: '0.00人民币' });
        expect(fetchMock.mock.calls[0][0]).toContain('code=SH600519');
        await getNativeFinancials('000001.SZ');
        expect(fetchMock.mock.calls[1][0]).toContain('code=SZ000001');
    });

    it.each([null, {}, { data: {} }, { result: { data: {} } }, [{ '公司代號': '2330', '營業收入': 999 }]])('rejects malformed schemas without invented reports: %j', async (payload) => {
        respond(payload);
        expect(await getNativeFinancials('2330.TW')).toBeNull();
        expect(await getNativeFinancials('700.HK')).toBeNull();
        expect(await getNativeFinancials('600519.SS')).toBeNull();
    });

    it('returns no curated financials on provider failure', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        expect(await getNativeFinancials('2330.TW')).toBeNull();
        expect(await getNativeFinancials('700.HK')).toBeNull();
    });

    it.each(['000001.SS', 'SSE:000300', 'HSI.HK', '^TWII', '0050.TW', '02800.HK', '6488.TWO', 'TPEX:6488', '430047.BJ'])('skips corporate providers for unsupported %s', async (symbol) => {
        expect(await getNativeFinancials(symbol)).toBeNull();
        const profile = await fetchCompanyProfile(symbol);
        expect(profile.status).toBe('unsupported');
        expect(fetchMock).not.toHaveBeenCalled();
        if (symbol.includes('6488')) expect(profile).toMatchObject({ symbol: '6488.TWO', exchange: '台湾柜买中心' });
        if (symbol.includes('.BJ')) expect(profile.exchange).toBe('北京证券交易所');
    });

    it('aborts an unresponsive provider within eight seconds', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        const result = getNativeFinancials('2330.TW');
        await vi.advanceTimersByTimeAsync(8000);
        expect(await result).toBeNull();
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    });
});

describe('dynamic company profiles', () => {
    it('prefers current TWSE registration data for formerly curated 2330', async () => {
        respond([{ '公司代號': '2330', '公司名稱': '来源当前名称', '董事長': '来源董事长', '實收資本額': '0' }]);
        const profile = await fetchCompanyProfile('2330.TW');
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('t187ap03_L'), expect.anything());
        expect(profile).toMatchObject({ name: '来源当前名称', chairman: '来源董事长', regCapital: '新台币 0 元', source: '台湾证券交易所 OpenAPI t187ap03_L' });
        expect(profile.intro).toBe('暂未取得公司简介。');
        expect(profile.businessScope).toBeUndefined();
    });

    it('uses HK provider descriptions without substituting secretary for chairman', async () => {
        respond({ result: { data: [{ ORG_NAME: '来源名称', ORG_PROFILE: '来源简介', MAIN_BUSINESS: '来源业务', SECRETARY: '不是董事长' }] } });
        expect(await fetchCompanyProfile('9988.HK')).toMatchObject({ name: '来源名称', intro: '来源简介', businessScope: '来源业务', chairman: undefined });
    });

    it('does not fabricate registration or business descriptions on failure', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        for (const symbol of ['2330.TW', '09988.HK', '600519.SS']) {
            const profile = await fetchCompanyProfile(symbol);
            expect(profile.status).toBe('unavailable');
            expect(profile.businessScope).toBeUndefined();
            expect(profile.intro).toBe('暂未取得公司简介。');
        }
    });

    it('validates profile schema and does not invent missing corporate descriptions', async () => {
        respond({ jbzl: { gsmc: { malicious: true } } });
        expect((await fetchCompanyProfile('600519.SS')).status).toBe('unavailable');
        respond({ jbzl: { gsmc: '来源企业', gyrs: 0, gswz: 'javascript://example.com' } });
        expect(await fetchCompanyProfile('600519.SS')).toMatchObject({ name: '来源企业', employees: '0 人', intro: '暂未取得公司简介。', website: undefined, businessScope: undefined });
    });
});
