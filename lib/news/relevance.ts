import { CHINESE_STOCKS } from '@/lib/chinese-stocks';
import { identifyMarketAndCode, type MarketType } from '@/lib/market/instrument';

// Company spelling normalization only; sector/search keywords are never aliases.
export const NAME_CHARACTERS: Record<string, string> = {
    積: '积', 電: '电', 聯: '联', 發: '发', 鴻: '鸿', 達: '达', 廣: '广', 長: '长', 榮: '荣', 國: '国',
    華: '华', 豐: '丰', 騰: '腾', 訊: '讯', 團: '团', 銀: '银', 貴: '贵', 寧: '宁', 時: '时', 藥: '药',
    業: '业', 東: '东', 財: '财', 匯: '汇', 龍: '龙', 興: '兴', 視: '视', 創: '创', 緯: '纬', 緻: '致',
    萬: '万', 寶: '宝', 險: '险', 灣: '湾', 體: '体', 製: '制', 臺: '台', 股: '股', 醫: '医', 療: '疗',
    軟: '软', 亞: '亚', 馬: '马', 雲: '云', 蟻: '蚁', 門: '门', 復: '复', 蘭: '兰', 遠: '远', 資: '资',
    環: '环', 穎: '颖', 碩: '硕', 漢: '汉', 測: '测', 實: '实', 億: '亿', 線: '线', 貿: '贸', 機: '机',
    聲: '声', 樂: '乐', 愛: '爱', 會: '会', 鋼: '钢', 啟: '启', 統: '统', 營: '营', 農: '农', 來: '来',
    鵬: '鹏', 傳: '传', 蘇: '苏', 產: '产', 銘: '铭', 鐵: '铁', 勝: '胜', 證: '证', 券: '券', 車: '车',
};

export function normalizeName(value: string): string {
    return value.replace(/[㐀-鿿]/g, (char) => NAME_CHARACTERS[char] || char).toLowerCase();
}

export function traditionalCompanyQuery(value: string): string {
    // Simplified-to-traditional conversion is ambiguous: preserve 台 and 致.
    return [...value].map((char) => char === '台' || char === '致' ? char
        : Object.keys(NAME_CHARACTERS).find((key) => NAME_CHARACTERS[key] === char) || char).join('');
}

const KNOWN_COMPANIES = new Map(CHINESE_STOCKS.map((stock) => [identifyMarketAndCode(stock.symbol).normalizedSymbol, stock.name]));

export function knownCompanyName(symbol: string): string {
    return KNOWN_COMPANIES.get(identifyMarketAndCode(symbol).normalizedSymbol) || '';
}

const COMPANY_ALIASES: Record<string, string[]> = {
    '00700.HK': ['腾讯', '騰訊'], '00981.HK': ['中芯国际', 'SMIC'],
    '01810.HK': ['小米'], '02318.HK': ['中国平安'], '09988.HK': ['阿里巴巴', 'Alibaba'],
};

export function aliasesFor(symbol: string, name: string): string[] {
    const canonical = identifyMarketAndCode(symbol).normalizedSymbol;
    const names = [name, knownCompanyName(canonical), ...(COMPANY_ALIASES[canonical] || [])];
    const aliases = names.flatMap((value) => [
        value.replace(/\s*[（(][\s\S]*?[）)]\s*/g, '').trim(),
        ...(value.match(/[（(]([^）)]+)[）)]/)?.[1].split(/\s*\/\s*/) || []),
    ]).filter((value) => !/^(?:\d+\.(?:SS|SH|SZ|BJ|HK|TW|TWO)|(?:TWSE|TPEX|SSE|SZSE|BSE|HKEX):\d+)$/i.test(value));
    aliases.push(identifyMarketAndCode(canonical).market === 'us' ? canonical : canonical.split('.')[0]);
    return [...new Set(aliases.map(normalizeName).filter((alias) => alias.length >= 2))];
}

function escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function relevant(title: string, summary: string, aliases: string[], source: 'eastmoney' | 'cnyes'): boolean {
    // EM snippets may echo the search query without actually discussing the company.
    const content = normalizeName(source === 'cnyes' ? `${title} ${summary}` : title);
    return aliases.some((alias) => {
        const escaped = escape(alias);
        if (/^\d+$/.test(alias)) {
            return new RegExp(`(?:[（(]\\s*${escaped}(?:\\.(?:tw|two|ss|sz|bj|hk))?\\s*[）)]|(?:twse|tpex|sse|szse|bse|hkex):${escaped}\\b|\\b${escaped}\\.(?:tw|two|ss|sz|bj|hk)\\b)`, 'i').test(content);
        }
        if (/^[a-z0-9 .&,-]+$/i.test(alias)) {
            return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(content);
        }
        return content.includes(alias);
    });
}

export type NewsTarget = { symbol: string; company?: string };

export function canonicalNewsTargets(items: NewsTarget[]): NewsTarget[] {
    const targets = new Map<string, NewsTarget>();
    for (const item of items) {
        if (!item.symbol?.trim()) continue;
        const symbol = identifyMarketAndCode(item.symbol).normalizedSymbol;
        const previous = targets.get(symbol);
        targets.set(symbol, { symbol, company: previous?.company || item.company?.trim() || knownCompanyName(symbol) });
    }
    return [...targets.values()];
}

export function newsAssociation(article: Pick<MarketNewsArticle, 'headline' | 'summary' | 'relatedSymbols'>, target: NewsTarget,
    options: { market?: MarketType; summary?: boolean; relatedNames?: string[] } = {}): NewsAssociation | undefined {
    const identity = identifyMarketAndCode(target.symbol);
    const symbol = identity.normalizedSymbol;
    if (article.relatedSymbols?.some((related) => identifyMarketAndCode(related).normalizedSymbol === symbol)) {
        return { symbol, reason: 'source-symbol', matchedText: symbol };
    }
    const aliases = aliasesFor(symbol, target.company || '').filter((alias) => !/^\d+$/.test(alias) && alias !== normalizeName(symbol));
    const content = options.summary ? `${article.headline} ${article.summary}` : article.headline;
    const name = aliases.find((alias) => relevant(content, '', [alias], 'eastmoney'));
    if (name) return { symbol, reason: 'company-name', matchedText: name };
    const relatedName = options.relatedNames?.find((value) => aliases.includes(normalizeName(value)));
    if (relatedName) return { symbol, reason: 'source-company', matchedText: relatedName };

    // An explicit exchange must match the exact canonical identity, including TW vs TWO.
    const tokens = content.match(/(?:TWSE|TPEX|SSE|SZSE|BSE|HKEX|NASDAQ|NYSE|AMEX):[A-Z0-9.-]+|[A-Z0-9]+\.(?:TWO|TW|SS|SH|SZ|BJ|HK)\b/gi) || [];
    const token = tokens.find((value) => identifyMarketAndCode(value).normalizedSymbol === symbol);
    if (token) return { symbol, reason: 'ticker', matchedText: token };
    if (identity.market === 'us') {
        const pattern = symbol.length === 1 ? `(?:\\$|(?:NASDAQ|NYSE|AMEX):)${escape(symbol)}(?![a-z0-9.-])`
            : `(^|[^a-z0-9.-])${escape(symbol)}([^a-z0-9.-]|$)`;
        if (new RegExp(pattern, 'i').test(content)) return { symbol, reason: 'ticker', matchedText: symbol };
    } else if (!options.market || options.market === identity.market) {
        const code = symbol.split('.')[0];
        const numeric = identity.market === 'hk' ? `0*${escape(code.replace(/^0+/, '') || '0')}` : escape(code);
        if (new RegExp(`[（(]\\s*${numeric}\\s*[）)]`).test(content)) {
            return { symbol, reason: 'ticker', matchedText: code };
        }
    }
    return undefined;
}

export function articleMarkets(article: MarketNewsArticle, relatedOnly = false): MarketType[] {
    const symbols = article.relatedSymbols?.length ? article.relatedSymbols : article.related && !['A股', '港股', '台股', '美股'].includes(article.related)
        ? [article.related] : [];
    const markets = symbols.map((symbol) => identifyMarketAndCode(symbol).market);
    if (!relatedOnly || !markets.length) {
        const category = ({ A股: 'cn', 港股: 'hk', 台股: 'tw', 美股: 'us', general: 'us', company: 'us' } as Record<string, MarketType>)[article.category];
        if (category) markets.push(category);
    }
    return [...new Set(markets)];
}
