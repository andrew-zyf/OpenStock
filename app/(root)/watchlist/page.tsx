import { Suspense } from 'react';
import { Plus } from 'lucide-react';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getUserAlerts } from '@/lib/actions/alert.actions';
import { alertsEnabled } from '@/lib/market-data';
import { getWatchlistData } from '@/lib/actions/finnhub.actions';
import { getWatchlistNews, getMultiMarketNews } from '@/lib/actions/china-market.actions';
import WatchlistTable from '@/components/watchlist/WatchlistTable';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
import NewsList from '@/components/watchlist/NewsList';
import Panel from '@/components/Panel';
import DataFreshness from '@/components/DataFreshness';
import { SearchButton } from '@/components/SearchCommand';
import type { WatchlistEntry } from '@/lib/watchlist-observation';

const RowsSkeleton = ({ rows = 4 }: { rows?: number }) => (
    <div className="row-list" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-3.5">
                <span className="size-8 animate-pulse rounded-full bg-hover" />
                <span className="h-3.5 flex-1 animate-pulse rounded-md bg-hover" />
                <span className="h-3.5 w-20 animate-pulse rounded-md bg-hover" />
            </div>
        ))}
    </div>
);

async function Symbols({ items }: { items: WatchlistEntry[] }) {
    return <WatchlistTable initialRows={await getWatchlistData(items)} />;
}

async function News({ items }: { items: { symbol: string; company?: string }[] }) {
    const [result, marketNews] = await Promise.all([getWatchlistNews(items), getMultiMarketNews()]);
    return <NewsList news={result.articles} marketNews={marketNews} status={result.status} sources={result.sources} coverage={result.coverage} />;
}

// DB reads render first; everything from Finnhub streams in behind skeletons.
export default async function WatchlistPage() {
    const [items, alerts] = await Promise.all([getUserWatchlist(), getUserAlerts()]);
    const symbols: string[] = items.map((item: { symbol: string }) => item.symbol);
    const activeAlerts = alerts.filter((a: { triggered?: boolean }) => !a.triggered).length;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">自选股票</h1>
                    <p className="page-sub num flex flex-wrap items-center gap-x-2">
                        已关注 {symbols.length} 只标的 <span aria-hidden>·</span> <DataFreshness />
                    </p>
                </div>
                <SearchButton className="btn btn-primary"><Plus /> 添加自选</SearchButton>
            </header>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
                <div className="flex min-w-0 flex-col gap-3">
                    <Panel title="股票列表" sub="记录观察理由与失效条件；行情、同市场基准和相关资讯辅助复核">
                        <Suspense fallback={<RowsSkeleton rows={Math.max(1, Math.min(symbols.length, 6))} />}>
                            <Symbols items={items} />
                        </Suspense>
                    </Panel>
                    <Panel title="自选资讯" sub="仅展示匹配关注标的的资讯，可切换全市场动态">
                        <Suspense fallback={<RowsSkeleton />}>
                            <News items={items} />
                        </Suspense>
                    </Panel>
                </div>

                <Panel title="价格预警" sub={alertsEnabled ? `${activeAlerts} 条未触发 · 后台检查依赖任务配置` : 'OpenStock 预警服务'} className="self-start">
                    <AlertsPanel alerts={alerts} />
                </Panel>
            </div>
        </>
    );
}
