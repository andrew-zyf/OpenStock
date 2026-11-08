import { Suspense } from 'react';
import { Plus } from 'lucide-react';
import { getUserWatchlist, getArchivedWatchlist } from '@/lib/actions/watchlist.actions';
import ResearchArchive from '@/components/watchlist/ResearchArchive';
import ResearchBackup from '@/components/watchlist/ResearchBackup';
import ResearchChanges from '@/components/watchlist/ResearchChanges';
import ResearchFacts from '@/components/watchlist/ResearchFacts';
import ResearchMaintenance from '@/components/watchlist/ResearchMaintenance';
import ResearchWorkspace from '@/components/watchlist/ResearchWorkspace';
import DailyResearchPanel from '@/components/watchlist/DailyResearchPanel';
import ManualPlans from '@/components/watchlist/ManualPlans';
import { getUserAlerts } from '@/lib/actions/alert.actions';
import { alertsEnabled } from '@/lib/market-data';
import WatchlistResearch from '@/components/watchlist/WatchlistResearch';
import { getWatchlistNews, getMultiMarketNews } from '@/lib/actions/china-market.actions';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
import AlertHealthStatus from '@/components/watchlist/AlertHealthStatus';
import MarketEventsCalendar from '@/components/watchlist/MarketEventsCalendar';
import NewsList from '@/components/watchlist/NewsList';
import Panel from '@/components/Panel';
import DataFreshness from '@/components/DataFreshness';
import { SearchButton } from '@/components/SearchCommand';

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

async function News({ items }: { items: { symbol: string; company?: string }[] }) {
    try {
        const [result, marketNews] = await Promise.all([getWatchlistNews(items), getMultiMarketNews()]);
        return <NewsList news={result.articles} marketNews={marketNews} status={result.status} sources={result.sources} coverage={result.coverage} />;
    } catch { return <p role="status" className="p-4 text-sm">资讯读取失败，不能据此判断没有新消息。请稍后刷新。</p>; }
}

export default async function WatchlistPage() {
    const [watchlistRead, alertsRead, archiveRead] = await Promise.allSettled([getUserWatchlist(), getUserAlerts(), getArchivedWatchlist()]);
    const items = watchlistRead.status === 'fulfilled' ? watchlistRead.value : [];
    const alerts = alertsRead.status === 'fulfilled' ? alertsRead.value : [];
    const archived = archiveRead.status === 'fulfilled' ? archiveRead.value : [];
    const watchlistAvailable = watchlistRead.status === 'fulfilled';
    const alertsAvailable = alertsRead.status === 'fulfilled';
    const archiveAvailable = archiveRead.status === 'fulfilled';
    const failed = [!watchlistAvailable && '自选研究', !alertsAvailable && '价格预警', !archiveAvailable && '归档研究'].filter(Boolean);
    const activeAlerts = alerts.filter((a: { triggered?: boolean }) => !a.triggered).length;

    return <>
        <header className="page-head">
            <div><h1 className="page-title">自选股票</h1>
                <p className="page-sub num flex flex-wrap items-center gap-x-2">{watchlistAvailable ? `已关注 ${items.length} 只标的` : '自选数量暂时未知'} <span aria-hidden>·</span> <DataFreshness /></p>
            </div>
            <SearchButton className="btn btn-primary"><Plus /> 添加自选</SearchButton>
        </header>
        {!!failed.length && <div role="status" className="panel mb-3 space-y-2 p-4 text-sm">
            <p>{failed.join('、')}读取失败，当前数量和内容未知。已保存资料未删除；请在「资料与维护」核对协调状态后重试。</p>
            <a href="#task-data" className="inline-block min-h-12 underline">查看资料与维护</a>
        </div>}
        <ResearchWorkspace activeSymbols={items.map(item => item.symbol)} archivedSymbols={archived.map(item => item.symbol)} activeAvailable={watchlistAvailable} archiveAvailable={archiveAvailable}
            due={<ResearchChanges />}
            observe={<>
                <div id="watchlist-observations" className="min-w-0">
                    <Panel title="股票列表" sub="记录观察理由与失效条件；行情、同市场基准和相关资讯辅助复核">
                        <WatchlistResearch items={watchlistAvailable ? items : null} />
                    </Panel>
                </div>
                <Panel title="价格预警" sub={!alertsAvailable ? '预警数量未知' : alertsEnabled ? `${activeAlerts} 条未触发 · 后台检查依赖任务配置` : 'OpenStock 预警服务'}>
                    <AlertHealthStatus />
                    {alertsAvailable ? <AlertsPanel alerts={alerts} /> : <p role="status" className="p-4 text-sm">预警读取失败，检测与投递状态未知，请刷新核对。</p>}
                </Panel>
                {watchlistAvailable && <MarketEventsCalendar items={items} />}
                {watchlistAvailable && <Panel title="自选资讯" sub="仅展示匹配关注标的的资讯，可切换全市场动态"><Suspense fallback={<RowsSkeleton />}><News items={items} /></Suspense></Panel>}
            </>}
            review={<div id="daily-research" className="min-w-0">{!watchlistAvailable && <p role="status" className="mb-3 text-sm">关注列表未读到；当前仍可读取固定组与已保存对照。</p>}<DailyResearchPanel watchedSymbols={items} /></div>}
            plans={<div id="manual-plans" className="min-w-0"><ManualPlans items={items} /></div>}
            facts={<ResearchFacts items={items} />}
            data={<>
                <ResearchMaintenance />
                {archiveAvailable ? <ResearchArchive entries={archived} alerts={alerts} alertsAvailable={alertsAvailable} /> : <p role="status" className="panel p-4 text-sm">归档研究读取失败，归档数量未知。请核对协调状态后刷新。</p>}
                <ResearchBackup />
            </>}
        />
    </>;
}
