'use client';

import { getAlertHealthStatus } from '@/lib/actions/alert-health.actions';
import type { AlertHealthSummary } from '@/lib/alerts/health';
import { useMarketResource } from '@/hooks/useMarketResource';
import { getCalendarMaintenanceSummary } from '@/lib/market/calendar';

const EXCHANGE_NAMES = { SSE: '沪市', SZSE: '深市', BSE: '北交所', HKEX: '港股', TWSE: '台湾上市', TPEX: '台湾上柜', US: '美股' };

const LABELS: Record<AlertHealthSummary['status'], string> = {
    'cached-mode': '缓存行情模式：未启用价格预警检查',
    unknown: '任务状态未知：暂时无法读取运行记录',
    'no-heartbeat': '尚无任务完成记录',
    recent: '最近一次任务已完成',
    overdue: '任务完成记录已逾期',
    failed: '最近一次任务失败',
};

function Timestamp({ value }: { value: string | null }) {
    // Explicit zone keeps SSR and the browser consistent. ISO values are instants, never local dates.
    return value ? <time dateTime={value}>{new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(value))}（UTC+8）</time> : <>暂无记录</>;
}

export default function AlertHealthStatus() {
    const { data, error, stale } = useMarketResource({
        key: 'alert-job-health', loader: getAlertHealthStatus, intervalMs: 60_000,
    });
    const status = error ? 'unknown' : data?.status;
    const nextYear = data ? Number(data.checkedAt.slice(0, 4)) + 1 : undefined;
    const calendars = nextYear ? getCalendarMaintenanceSummary(nextYear) : [];
    const verified = calendars.filter(calendar => !calendar.renewalRequired);
    const renewal = calendars.filter(calendar => calendar.renewalRequired);
    return (
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-300">
            <h2 className="mb-2 font-semibold text-gray-100">提醒任务运行记录</h2>
            <p role={status ? 'status' : undefined}>{status ? LABELS[status] : '正在读取任务运行记录'}</p>
            {stale && <p className="mt-1 text-amber-300">以下为上次读取的记录，当前状态待确认。</p>}
            {data && data.status !== 'cached-mode' && <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                <div><dt>最近开始</dt><dd><Timestamp value={data.lastStartedAt} /></dd></div>
                <div><dt>最近完成</dt><dd><Timestamp value={data.lastCompletedAt} /></dd></div>
                <div><dt>最近失败</dt><dd><Timestamp value={data.lastFailedAt} /></dd></div>
            </dl>}
            <p className="mt-2 text-xs text-gray-400">
                {status === 'cached-mode' ? '此模式不执行价格预警采样。' : '计划每 5 分钟检查；超过 15 分钟未完成视为逾期。仅表示已记录的运行结果，不代表持续在线或邮件已送达。'}
            </p>
            {nextYear && <p className="mt-2 text-xs text-gray-400">
                {nextYear} 年日历：{verified.length ? `${verified.map(calendar => EXCHANGE_NAMES[calendar.exchange]).join('、')}已核验。` : '尚无全年核验覆盖。'}
                {renewal.length > 0 && `${renewal.map(calendar => EXCHANGE_NAMES[calendar.exchange]).join('、')}待官方日历核验（现有覆盖至 ${[...new Set(renewal.map(calendar => calendar.verifiedThrough))].join(' / ')}），需续期。`}
            </p>}
        </section>
    );
}
