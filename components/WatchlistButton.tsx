"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { addToWatchlist, removeFromWatchlist } from "@/lib/actions/watchlist.actions";
import { cn } from "@/lib/utils";

interface WatchlistButtonProps {
    symbol: string;
    company: string;
    isInWatchlist: boolean;
    variant?: "button" | "icon";
    onWatchlistChange?: (symbol: string, added: boolean) => void;
}

const WatchlistButton = ({ symbol, company, isInWatchlist, variant = "button", onWatchlistChange }: WatchlistButtonProps) => {
    const router = useRouter();
    const [added, setAdded] = useState(isInWatchlist);
    const [loading, setLoading] = useState(false);

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault(); // may sit inside a link

        const next = !added;
        setAdded(next); // optimistic
        setLoading(true);
        try {
            if (next) {
                const result = await addToWatchlist(symbol, company);
                if (result && 'error' in result) {
                    setAdded(false);
                    toast.error(result.error);
                    return;
                }
            } else {
                const result = await removeFromWatchlist(symbol);
                if ('error' in result) { setAdded(true); toast.error(String(result.error)); return; }
            }
            toast.success(next ? `已将 ${symbol} 添加至自选，已有研究会恢复` : `已归档 ${symbol}，研究历史保留；关联预警继续独立运行，可在研究归档中停用`);
            onWatchlistChange?.(symbol, next);
            router.refresh(); // sidebar lists the watchlist from the layout
        } catch (error) {
            console.error("Watchlist action failed:", error);
            setAdded(!next);
            toast.error("更新自选列表失败");
        } finally {
            setLoading(false);
        }
    };

    const label = added ? `将 ${symbol} 移出自选并归档研究` : `添加 ${symbol} 到自选`;

    if (variant === "icon") {
        return (
            <button type="button" onClick={handleClick} disabled={loading} className={cn('icon-btn', added && 'is-on')} title={label} aria-label={label} aria-pressed={added}>
                <Star fill={added ? 'currentColor' : 'none'} />
            </button>
        );
    }

    return (
        <button type="button" onClick={handleClick} disabled={loading} className={cn('btn btn-ghost', added && 'is-on')} aria-pressed={added}>
            <Star fill={added ? 'currentColor' : 'none'} />
            {added ? '已自选' : '加自选'}
        </button>
    );
};

export default WatchlistButton;
