import { identifyMarketAndCode, type MarketType } from '@/lib/market/instrument';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { fetchProviderJson, numeric, record, records, text } from '@/lib/market/financials';

export type CompanyProfileData = {
    symbol: string;
    market: MarketType;
    name: string;
    engName?: string;
    industry: string;
    sector?: string;
    exchange: string;
    listingDate?: string;
    chairman?: string;
    generalManager?: string;
    employees?: string;
    regCapital?: string;
    website?: string;
    address?: string;
    intro: string;
    businessScope?: string;
    source?: string;
    status?: 'available' | 'unavailable' | 'unsupported';
};

function website(value: unknown): string | undefined {
    const raw = text(value);
    if (!raw) return undefined;
    try {
        const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
    } catch {
        return undefined;
    }
}

function employees(value: unknown): string | undefined {
    const count = numeric(value);
    return count !== undefined && count >= 0 ? `${count.toLocaleString('zh-CN')} 人` : undefined;
}

export async function fetchCompanyProfile(rawSymbol: string): Promise<CompanyProfileData> {
    const meta = identifyMarketAndCode(rawSymbol);
    const sym = meta.normalizedSymbol.toUpperCase();
    const missing: CompanyProfileData = {
        symbol: sym,
        market: meta.market,
        name: sym,
        industry: '行业资料暂缺',
        exchange: meta.exchange,
        intro: '暂未取得公司简介。',
        status: 'unavailable',
    };
    if (!getInstrumentCapabilities(rawSymbol).profile) {
        return { ...missing, status: 'unsupported', intro: '当前标的不支持公司档案查询。' };
    }

    if (meta.market === 'cn' && (sym.endsWith('.SS') || sym.endsWith('.SZ'))) {
        const code = `${sym.endsWith('.SS') ? 'SH' : 'SZ'}${sym.split('.')[0]}`;
        const json = record(await fetchProviderJson(`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${code}`));
        const b = record(json?.jbzl);
        const f = record(json?.fxxg);
        const name = text(b?.gsmc) || text(b?.agjc);
        if (b && name) {
            return {
                ...missing,
                name,
                engName: text(b.ywmc),
                industry: text(b.sshy) || text(b.sszjhhy) || missing.industry,
                sector: text(b.sszjhhy),
                listingDate: text(f?.ssrq),
                chairman: text(b.dsz) || text(b.frdb),
                generalManager: text(b.zjl),
                employees: employees(b.gyrs),
                regCapital: text(b.zczb),
                website: website(b.gswz),
                address: text(b.bgdz) || text(b.zcdz),
                intro: text(b.gsjj) || missing.intro,
                businessScope: text(b.jyfw),
                source: '东方财富 F10',
                status: 'available',
            };
        }
    }

    if (meta.market === 'hk') {
        const num = sym.replace(/\.HK$/, '').padStart(5, '0');
        const secucode = `${num}.HK`;
        const json = record(await fetchProviderJson(`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_INFO_ORGPROFILE&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)`));
        const d = records(record(json?.result)?.data).find((item) => !item.SECUCODE || item.SECUCODE === secucode);
        const name = text(d?.ORG_NAME) || text(d?.SECURITY_NAME_ABBR);
        if (d && name) {
            return {
                ...missing,
                name,
                engName: text(d.ORG_EN_ABBR),
                industry: text(d.BELONG_INDUSTRY) || missing.industry,
                sector: text(d.INDUSTRY_TYPE),
                listingDate: text(d.LISTING_DATE)?.slice(0, 10),
                chairman: text(d.CHAIRMAN),
                employees: employees(d.EMP_NUM),
                regCapital: text(d.REG_CAPITAL),
                website: website(d.ORG_WEB),
                address: text(d.ADDRESS) || text(d.REG_ADDRESS),
                intro: text(d.ORG_PROFILE) || missing.intro,
                businessScope: text(d.MAIN_BUSINESS),
                source: '东方财富港股 F10',
                status: 'available',
            };
        }
    }

    // TWSE _L is not a TPEx source. Never send .TWO companies to this dataset.
    if (meta.market === 'tw' && sym.endsWith('.TW')) {
        const code = sym.replace(/\.TW$/, '');
        const list = records(await fetchProviderJson('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'));
        const row = list.find((item) => text(item['公司代號']) === code);
        const name = text(row?.['公司名稱']);
        if (row && name) {
            const rawDate = text(row['上市日期']);
            const listingDate = rawDate && /^\d{8}$/.test(rawDate)
                ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
            const capital = numeric(row['實收資本額']);
            return {
                ...missing,
                name,
                engName: text(row['英文簡稱']),
                listingDate,
                chairman: text(row['董事長']),
                generalManager: text(row['總經理']),
                regCapital: capital !== undefined ? `新台币 ${capital.toLocaleString('zh-CN')} 元` : undefined,
                website: website(row['網址']),
                address: text(row['住址']),
                // Registration fields are not a description of the company's business.
                intro: text(row['公司簡介']) || missing.intro,
                businessScope: text(row['主要經營業務']),
                source: '台湾证券交易所 OpenAPI t187ap03_L',
                status: 'available',
            };
        }
    }

    return missing;
}
