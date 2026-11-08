import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getInstrumentSession } from '@/lib/market/sessions';
import { exchangeTimeZone } from '@/lib/market/dates';

export default function TradingContext({ symbol }: { symbol: string }) {
    const meta = identifyMarketAndCode(symbol);
    const session = getInstrumentSession(symbol);
    const rules = meta.market === 'hk' ? {
        url: 'https://www.hkex.com.hk/Global/Exchange/FAQ/Securities-Market/Trading/Securities-Market-Operations?sc_lang=zh-HK', label: '港交所证券市场运作',
        note: '每手股数由具体证券发行人确定；本证券每手股数尚未核验。整手和零股交易安排不同，不统一假定为 100 股。',
    } : meta.market === 'tw' ? {
        url: meta.exchangeId === 'TPEX' ? 'https://www.tpex.org.tw/' : 'https://www.twse.com.tw/zh/products/system/trading.html', label: meta.exchangeId === 'TPEX' ? 'TPEx 市场规则' : 'TWSE 交易制度',
        note: meta.exchangeId === 'TPEX' ? '本标的属于上柜市场。TWSE 上市资料不能用于确认其交易单位或当冲资格，请核对 TPEx 与券商资料。' : '一般整股交易单位为 1000 股，部分证券例外；本证券单位尚未单独核验。股与张须区分，报价可用不代表账户具备当冲资格。',
    } : meta.market === 'cn' ? {
        url: meta.exchangeId === 'SZSE' ? 'https://www.szse.cn/lawrules/' : meta.exchangeId === 'BSE' ? 'https://www.bse.cn/business_rules/' : 'https://www.sse.com.cn/lawandrules/',
        label: `${meta.exchange}交易规则`, note: '涨跌幅、风险警示、停复牌与回转交易规则须按板块、证券类型及生效日期核验。当前未接入逐证券规则与实时停牌状态，不据代码统一推断。',
    } : {
        url: 'https://www.nyse.com/markets/hours-calendars', label: '美国市场日历参考',
        note: '日历以纽约当地日期及夏令时为准；盘前和盘后财报时间应另行确认。计划时段不能证明某只证券此刻可成交。',
    };
    return <details className="hatch min-w-0 p-3 text-xs">
        <summary className="cursor-pointer font-medium">交易上下文 · {meta.exchange} · {meta.currency}</summary>
        <div className="mt-3 flex flex-col gap-2 text-faint">
            <p>页面加载时日历日期：{session.exchangeDate} · {exchangeTimeZone(symbol)} · {session.label}{session.calendarStatus !== 'verified' ? ' · 当前年度日历未核验' : ''}。行情所属交易日仍以来源时间为准。</p>
            <p>{rules.note}</p>
            <p>价格与成交单位不等于持仓成本或可成交数量；观察价变动未包含费用、汇率及公司行为。</p>
            <a href={rules.url} target="_blank" rel="noreferrer" className="underline">核对 {rules.label}</a>
        </div>
    </details>;
}
