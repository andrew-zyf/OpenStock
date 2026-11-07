'use client';

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Code2, Heart, Info, LayoutDashboard, LifeBuoy, LogOut, Search, Star } from "lucide-react";
import { openSearch } from "@/components/SearchCommand";
import { signOut } from "@/lib/actions/auth.actions";
import { cn } from "@/lib/utils";

type SidebarProps = {
    user: User;
    watchlist: { symbol: string; company: string }[];
};

const RESOURCES = [
    { href: '/help', label: '帮助支持', icon: LifeBuoy },
    { href: '/api-docs', label: 'API 文档', icon: Code2 },
    { href: '/about', label: '关于我们', icon: Info },
    { href: '/terms', label: '服务条款', icon: BookOpen },
];

const Sidebar = ({ user, watchlist }: SidebarProps) => {
    const pathname = usePathname();
    const router = useRouter();

    const handleSignOut = async () => {
        await signOut();
        router.push('/sign-in');
    };

    return (
        <aside className="sidebar">
            <Link href="/dashboard" className="px-2 pt-1 pb-2" aria-label="OpenStock 控制台">
                <Image src="/assets/images/logo.png" alt="OpenStock" width={150} height={38} priority />
            </Link>

            <button type="button" onClick={openSearch} className="side-cta">
                <Search className="size-4" strokeWidth={2.5} />
                <span className="flex-1 text-left">搜索股票代码或名称</span>
                <kbd className="kbd bg-on-brand/10">⌘K</kbd>
            </button>

            <nav className="flex flex-col gap-0.5">
                <Link href="/dashboard" className={cn('side-item', pathname === '/dashboard' && 'is-active')}>
                    <LayoutDashboard /> 市场概览
                </Link>
                <Link href="/watchlist" className={cn('side-item', pathname === '/watchlist' && 'is-active')}>
                    <Star /> <span className="flex-1">自选股票</span>
                    <span className="num text-xs text-faint">{watchlist.length}</span>
                </Link>
            </nav>

            <div className="flex min-h-0 flex-col gap-1">
                <p className="side-label shrink-0">关注列表</p>
                {watchlist.length === 0 ? (
                    <p className="px-2.5 text-[12.5px] text-faint">点击星标关注股票以固定在此处。</p>
                ) : (
                    <ul className="scrollbar-hide-default flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                        {watchlist.map(({ symbol, company }) => (
                            <li key={symbol}>
                                <Link
                                    href={`/stocks/${symbol}`}
                                    title={company}
                                    className={cn('side-item h-8 font-medium', pathname === `/stocks/${symbol}` && 'is-active')}
                                >
                                    <span className="mono w-14 shrink-0 text-[12.5px] font-semibold text-foreground">{symbol}</span>
                                    {company !== symbol && <span className="truncate text-[12.5px] text-faint">{company}</span>}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="mt-auto flex flex-col gap-0.5">
                {RESOURCES.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={cn('side-item h-8', pathname === href && 'is-active')}>
                        <Icon /> {label}
                    </Link>
                ))}
                <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('open-donate-popup'))}
                    className="side-item h-8 text-left"
                >
                    <Heart /> 支持 OpenStock
                </button>
            </div>

            <div className="flex items-center gap-2.5 border-t border-line pt-3 px-1">
                <Link href="/profile" className={cn('-m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] p-1 transition-colors hover:bg-white/5', pathname === '/profile' && 'bg-white/5')}>
                    <span className="grid size-8 flex-none place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink">
                        {user.name?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-foreground">{user.name}</span>
                        <span className="block truncate text-[12px] text-faint">{user.email}</span>
                    </span>
                </Link>
                <button type="button" onClick={handleSignOut} className="icon-btn" title="退出登录" aria-label="退出登录">
                    <LogOut />
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
