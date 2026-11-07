import Link from "next/link";
import { ArrowUpRight, Bell, CandlestickChart, Command, GitPullRequest, Github, Grid3x3, HeartHandshake, MailOpen, MessagesSquare, Star } from "lucide-react";
import { MarketDial, MarketStatus } from "@/components/landing/MarketClock";
import ProductPreview from "@/components/landing/ProductPreview";
import SectionHead from "@/components/marketing/SectionHead";
import IconCard from "@/components/marketing/IconCard";
import { getSession } from "@/lib/better-auth/auth";
import { formatCount, getRepoStats } from "@/lib/github";
import { cn } from "@/lib/utils";
import { sidebarSponsors } from "@/lib/sponsors";
import { DISCORD_URL, GOOD_FIRST_ISSUES_URL, REPO_URL } from "@/lib/constants";

const FEATURES = [
    { icon: CandlestickChart, title: '生动流畅的专业图表', body: '基于 TradingView 专业 K 线、技术指标与财务图表，随时支持全屏沉浸式分析。' },
    { icon: Bell, title: '邮件价格预警', body: '设置高于或低于目标价格。系统每 5 分钟自动检测一次，触发时第一时间邮件通知。' },
    { icon: MessagesSquare, title: '一览社交舆情', body: '综合 Reddit、X、新闻与预测市场的讨论热度与多空情绪，全方位呈现。' },
    { icon: Grid3x3, title: '掌控全局市场', body: '行业热力图、涨跌领跑榜与市场要闻汇聚同屏，盘前尽知市场动向。' },
    { icon: Command, title: '⌘K 快捷全局搜索', body: '快速检索全球主要交易所资产代码，像浏览器标签页一样多任务管理。' },
    { icon: MailOpen, title: '每周精选简报', body: 'AI 智能生成您关注股票的周度资讯精要与市场速递。' },
];

const TIERS = [
    {
        name: '社区版', price: '免费', cadence: '每小时刷新', perHour: 1,
        body: '公开站点。行情每小时刷新，边缘缓存共享。专业 K 线图表保持实时。',
        cta: { label: '免费开始', href: '/sign-up' },
    },
    {
        name: 'OpenStock 云端版', price: '$5', per: '/月', tag: '即将上线', cadence: '每 15 秒刷新', perHour: 240,
        body: '包含高频实时行情与邮件价格预警，由云端集群统一托管，开箱即用。',
        cta: { label: '在 Discord 获取上线提醒', href: DISCORD_URL },
    },
    {
        name: '私有化部署', price: '免费开源', cadence: '自主配置', perHour: 240,
        body: '在您自己的服务器上使用您自己的 Finnhub Key 运行：为您和团队提供实时行情与预警。',
        cta: { label: '部署指南', href: '#self-host' },
    },
];

const SUPPORT = [
    {
        icon: HeartHandshake, title: '赞助支持', primary: true,
        body: '提供每月 $5 起的赞助档位或单次赞助。赞助商将展示在官网、应用内与 README。',
        cta: { label: '查看赞助方案', href: '/sponsor' },
    },
    {
        icon: GitPullRequest, title: '参与贡献',
        body: '挑选适合新手的 Good First Issue、完善文档或设计界面，每一份 PR 都让 OpenStock 更加完善。',
        cta: { label: '新手 Issue', href: GOOD_FIRST_ISSUES_URL },
    },
    {
        icon: Star, title: '分享传播',
        body: '给我们的 GitHub 仓库点亮 Star，并分享给正在为昂贵商业终端付费的朋友。',
        cta: { label: '在 GitHub 上 Star', href: REPO_URL },
    },
];

// 60 minutes of updates drawn as ticks: one line per refresh.
const CadenceRail = ({ perHour }: { perHour: number }) => (
    <div
        className="h-7 rounded-md bg-page shadow-[inset_0_0_0_1px_var(--line)]"
        style={{
            backgroundImage: perHour > 1
                ? `repeating-linear-gradient(90deg, var(--brand) 0 1px, transparent 1px calc(100% / ${perHour}))`
                : 'linear-gradient(90deg, var(--brand) 0 2px, transparent 2px)',
        }}
        aria-hidden
    />
);

// Floats in the empty gutter beside the 1200px column, so it only shows on screens wide enough to have one.
const SponsorBanner = () => {
    const [sponsor] = sidebarSponsors();
    if (!sponsor) return null;
    return (
        <aside aria-label="赞助商" className="fixed top-[130px] z-30 hidden w-[200px] right-[calc((100vw-1200px)/4-100px)] min-[1680px]:block">
            <a href={sponsor.url} target="_blank" rel="noreferrer" className="hatch group">
                <div className="card flex flex-col gap-4 p-5">
                    <p className="kicker flex items-center gap-1.5 text-brand-ink"><span className="live-dot" /> 赞助商</p>
                    {sponsor.logo && <img src={sponsor.logo} alt={sponsor.iconOnly ? '' : sponsor.name} className="h-14 w-auto self-start" />}
                    <div>
                        <p className="text-[17px] font-bold tracking-[-0.02em]">{sponsor.name}</p>
                        {sponsor.blurb && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{sponsor.blurb}</p>}
                    </div>
                    <span className="btn btn-ghost h-9 text-[13px] group-hover:bg-[var(--hover)] group-hover:text-foreground">访问 {sponsor.name} <ArrowUpRight /></span>
                </div>
            </a>
        </aside>
    );
};

export default async function LandingPage() {
    const [session, repo] = await Promise.all([getSession(), getRepoStats()]);
    const start = session?.user ? { href: '/dashboard', label: '进入控制台' } : { href: '/sign-up', label: '免费开始使用' };

    return (
        <>
            <SponsorBanner />
            <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pt-14 md:pt-20 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                    <MarketStatus />
                    <h1 className="mt-6 text-[44px] font-bold leading-[1.02] tracking-[-0.05em] md:text-[68px]">
                        告别昂贵付费墙，<br />拥抱开放金融。
                    </h1>
                    <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
                        OpenStock 是昂贵商业金融终端的开源替代方案。跟踪资产价格、纵览全球市场、深入公司洞察，完全开源，人人可用。
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-2">
                        <Link href={start.href} className="btn btn-primary h-11 px-5 text-[15px]">{start.label}</Link>
                        <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn btn-ghost h-11 px-5 text-[15px]">
                            <Github /> 私有化部署
                            {repo && <span className="num text-faint">{formatCount(repo.stars)} 星标</span>}
                        </a>
                    </div>
                </div>
                <div className="hatch">
                    <div className="card px-6 pb-5 pt-6"><MarketDial /></div>
                </div>
            </section>

            <section className="mx-auto mt-16 max-w-[1200px] px-5">
                <ProductPreview />
            </section>

            <section id="inside" className="mx-auto mt-28 max-w-[1200px] scroll-mt-24 px-5">
                <SectionHead kicker="功能特色" title="专为大众打造的现代金融终端。" sub="无需昂贵订阅，在一个界面满足您的所有行情与分析需求。" />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {FEATURES.map(({ icon, title, body }) => (
                        <IconCard key={title} icon={icon} title={title}>{body}</IconCard>
                    ))}
                </div>
            </section>

            <section id="data" className="mx-auto mt-28 max-w-[1200px] scroll-mt-24 px-5">
                <SectionHead
                    kicker="数据源"
                    title="自由选择行情更新频率。"
                    sub="图表直接从 TradingView 实时加载；行情报价、自选列表与价格预警由 Finnhub 驱动。"
                />
                <div className="grid gap-3 lg:grid-cols-3">
                    {TIERS.map((tier) => (
                        <div key={tier.name} className="hatch">
                            <div className="card flex h-full flex-col gap-4 p-5">
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="text-[18px] font-bold tracking-[-0.02em]">{tier.name}</h3>
                                    {tier.tag && <span className="pill is-brand">{tier.tag}</span>}
                                </div>
                                <p className="bento-value text-[30px]">{tier.price}{tier.per && <small className="text-faint"> {tier.per}</small>}</p>
                                <p className="text-[14px] leading-relaxed text-muted-foreground">{tier.body}</p>
                                <div className="mt-auto flex flex-col gap-2">
                                    <CadenceRail perHour={tier.perHour} />
                                    <p className="num flex justify-between text-[12px] text-faint">
                                        <span>{tier.cadence}</span>
                                        <span>{tier.perHour} 次 / 小时</span>
                                    </p>
                                </div>
                                <Link
                                    href={tier.cta.href}
                                    className={cn('btn', tier.name === '社区版' ? 'btn-primary' : 'btn-ghost')}
                                    {...(tier.cta.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
                                >
                                    {tier.cta.label}
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section id="self-host" className="mx-auto mt-28 grid max-w-[1200px] scroll-mt-24 items-start gap-10 px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div>
                    <SectionHead
                        kicker="私有部署"
                        title="自有服务器，自有秘钥，全实时行情。"
                        sub="支持配置多个免费 Finnhub Key。切换为 realtime 模式后，行情每 15 秒更新一次。"
                    />
                    <a href={`${REPO_URL}#docker-setup`} target="_blank" rel="noreferrer" className="btn btn-ghost">查看 README 部署文档</a>
                </div>
                <div className="hatch">
                    <pre className="card mono overflow-x-auto p-5 text-[13px] leading-7 text-muted-foreground">
                        <span className="text-faint">$ </span><span className="text-foreground">git clone {REPO_URL}.git</span>{'\n'}
                        <span className="text-faint">$ </span><span className="text-foreground">cd OpenStock</span>{'\n\n'}
                        <span className="text-faint"># .env (完整环境变量见 README)</span>{'\n'}
                        <span className="text-brand-ink">FINNHUB_API_KEYS</span>=key_one,key_two,key_three{'\n'}
                        <span className="text-brand-ink">NEXT_PUBLIC_OPENSTOCK_DATA_MODE</span>=realtime{'\n\n'}
                        <span className="text-faint">$ </span><span className="text-foreground">docker compose up -d --build</span>
                    </pre>
                </div>
            </section>

            <section id="sponsor" className="mx-auto mt-28 max-w-[1200px] scroll-mt-24 px-5">
                <SectionHead
                    kicker="开源支持"
                    title="OpenStock 欢迎赞助与支持。"
                    sub="在个人与企业的赞助支持下，OpenStock 持续保持开放、自由与免费。"
                />
                <div className="grid gap-3 lg:grid-cols-3">
                    {SUPPORT.map(({ icon, title, body, cta, primary }) => (
                        <IconCard
                            key={title}
                            icon={icon}
                            title={title}
                            footer={
                                <a href={cta.href} {...(cta.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})} className={cn('btn w-full', primary ? 'btn-primary' : 'btn-ghost')}>
                                    {cta.label}
                                </a>
                            }
                        >
                            {body}
                        </IconCard>
                    ))}
                </div>
            </section>

            <section className="mx-auto mt-28 max-w-[1200px] px-5">
                <div className="hatch">
                    <div className="card grid gap-10 p-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:p-12">
                        <div>
                            <p className="kicker text-brand-ink">Open Dev Society</p>
                            <blockquote className="mt-4 text-[26px] font-semibold leading-snug tracking-[-0.03em] md:text-[30px]">
                                技术应属于每一个人。知识应当公开、自由且人人皆可获得。
                            </blockquote>
                            <div className="mt-8 flex flex-wrap gap-2">
                                <Link href={start.href} className="btn btn-primary h-11 px-5 text-[15px]">{start.label}</Link>
                                <Link href="/about" className="btn btn-ghost h-11 px-5 text-[15px]">阅读宣言</Link>
                            </div>
                        </div>
                        {repo && (
                            <dl className="grid grid-cols-2 content-end gap-3">
                                {[
                                    ['星标数', formatCount(repo.stars)],
                                    ['分支数', formatCount(repo.forks)],
                                    ['开源协议', repo.license ?? 'AGPL-3.0'],
                                    ['开发语言', 'TypeScript'],
                                ].map(([label, value]) => (
                                    <div key={label} className="bento-tile col-span-1 bg-page">
                                        <dt className="kicker">{label}</dt>
                                        <dd className="bento-value text-[26px]">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    </div>
                </div>
            </section>
        </>
    );
}
