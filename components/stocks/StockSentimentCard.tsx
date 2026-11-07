import type { StockSentimentInsights } from '@/lib/actions/adanos.helpers';
import { cn } from '@/lib/utils';

interface StockSentimentCardProps {
    insight: StockSentimentInsights | null;
}

function formatScore(value: number | null, suffix: string): string {
    if (value === null) return '—';
    return `${value.toFixed(1)}${suffix}`;
}

function formatCompactNumber(value: number): string {
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
}

const TREND_CLASS: Record<string, string> = {
    rising: 'is-up',
    falling: 'is-down',
    stable: '',
};

const ALIGNMENT_LABELS: Record<string, string> = {
    'Bullish alignment': '一致看多',
    'Bearish alignment': '一致看空',
    'Wide divergence': '分歧极大',
    'Mixed': '多空分化',
};

const TREND_LABELS: Record<string, string> = {
    rising: '上升',
    falling: '下降',
    stable: '平稳',
};

function getAlignmentClass(alignment: string): string {
    if (alignment === 'Bullish alignment') return 'text-up';
    if (alignment === 'Bearish alignment' || alignment === 'Wide divergence') return 'text-down';
    if (alignment === 'Mixed') return 'text-warn';
    return 'text-muted-foreground';
}

export default function StockSentimentCard({ insight }: StockSentimentCardProps) {
    if (!insight) {
        return null;
    }

    const summary = [
        { label: '平均热度', value: formatScore(insight.averageBuzz, '/100') },
        { label: '看多均值', value: formatScore(insight.bullishAverage, '%') },
        { label: '数据覆盖', value: `${insight.availableSources}/4 数据源` },
    ];

    return (
        <div className="flex flex-col">
            <div className="grid grid-cols-3 gap-2 p-3">
                {summary.map(({ label, value }) => (
                    <div key={label} className="min-w-0">
                        <p className="kicker">{label}</p>
                        <p className="num mt-1 truncate font-bold text-foreground">{value}</p>
                    </div>
                ))}
            </div>
            <p className="border-t border-line px-3 py-2.5 text-[12.5px] text-faint">
                各方态度倾斜: <span className={cn('font-semibold', getAlignmentClass(insight.sourceAlignment))}>{ALIGNMENT_LABELS[insight.sourceAlignment] ?? insight.sourceAlignment}</span>
            </p>

            <ul className="row-list border-t border-line">
                {insight.sources.map((source) => (
                    <li key={source.source} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{source.label}</p>
                            <p className="num truncate text-[12px] text-faint">
                                {formatCompactNumber(source.metricValue)} {source.metricLabel.toLowerCase()}
                            </p>
                        </div>
                        <div className="num text-right text-[12.5px]">
                            <p className="font-semibold text-foreground">{formatScore(source.buzzScore, '')}</p>
                            <p className="text-faint">热度</p>
                        </div>
                        <span className={cn('pill w-[74px] justify-center capitalize', TREND_CLASS[source.trend ?? ''])}>
                            {source.bullishPct !== null ? `${source.bullishPct.toFixed(0)}% 看多` : (TREND_LABELS[source.trend ?? ''] ?? source.trend ?? '无趋势')}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
