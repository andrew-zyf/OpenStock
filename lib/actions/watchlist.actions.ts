'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { getSymbolAliases } from '@/lib/utils';
import { identifyMarketAndCode } from '@/lib/market/instrument';

// Tickers as Finnhub writes them (AAPL, BRK.B, RELIANCE.NS, M&M.NS, 0700.HK, BINANCE:BTCUSDT). Server actions take
// untrusted input, and every symbol here becomes Finnhub calls on /watchlist and in the news digest.
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&:-]{0,24}$/;
const MAX_WATCHLIST = 50;

// -- CRUD Operations --

export async function addToWatchlist(symbol: string, company: string) {
    const userId = await requireUserId();
    const input = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(input)) throw new Error('无效的股票代码');
    const ticker = identifyMarketAndCode(input).normalizedSymbol;
    const name = String(company ?? '').trim().slice(0, 120);
    try {
        await connectToDatabase();

        const existing = await Watchlist.findOne({ userId, symbol: { $in: getSymbolAliases(input) } });
        if (existing) return { ...JSON.parse(JSON.stringify(existing)), symbol: ticker };

        if ((await Watchlist.countDocuments({ userId })) >= MAX_WATCHLIST) {
            return { error: `自选列表已满（上限 ${MAX_WATCHLIST} 只股票），请移除部分后再添加。` };
        }

        // Keep saved metadata and addedAt intact if another request inserted it.
        const newItem = await Watchlist.findOneAndUpdate(
            { userId, symbol: ticker },
            { $setOnInsert: { userId, symbol: ticker, company: name, addedAt: new Date() } },
            { upsert: true, new: true }
        );

        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return JSON.parse(JSON.stringify(newItem));
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        throw new Error('添加自选失败');
    }
}

export async function removeFromWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        await Watchlist.deleteMany({ userId, symbol: { $in: getSymbolAliases(symbol) } });
        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('移出自选失败');
    }
}

export async function getUserWatchlist() {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const watchlist = await Watchlist.find({ userId }).sort({ addedAt: -1 });
        type SavedItem = { symbol: string; company: string; addedAt: string; [key: string]: unknown };
        const saved: SavedItem[] = JSON.parse(JSON.stringify(watchlist));
        const canonicalItems = new Map<string, SavedItem>();
        for (const item of saved) {
            const canonical = identifyMarketAndCode(item.symbol).normalizedSymbol;
            const existing = canonicalItems.get(canonical);
            if (!existing) {
                canonicalItems.set(canonical, { ...item, symbol: canonical });
                continue;
            }
            const earliest = new Date(item.addedAt) < new Date(existing.addedAt) ? item : existing;
            const usefulName = [existing.company, item.company].find((name) =>
                name?.trim() && !getSymbolAliases(canonical).includes(name.trim().toUpperCase()));
            canonicalItems.set(canonical, {
                ...earliest,
                symbol: canonical,
                company: usefulName || earliest.company,
            });
        }
        return [...canonicalItems.values()].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

// Check if a symbol is in the user's watchlist
export async function isStockInWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const item = await Watchlist.findOne({ userId, symbol: { $in: getSymbolAliases(symbol) } });
        return !!item;
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        return false;
    }
}
