'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Alert } from '@/database/models/alert.model';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { alertsEnabled } from '@/lib/market-data';
import { getInstrumentCapabilities } from '@/lib/market/capabilities';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { getAlertObservations } from '@/lib/alerts/quotes';
import { MAX_ACTIVE_ALERTS, MAX_ALERT_DAYS } from '@/lib/alerts/evaluation';

// Validate before normalization: symbols also appear in alert emails.
const SYMBOL_PATTERN = /^(?:[A-Z]+:)?[A-Z0-9][A-Z0-9.-]{0,19}$/;
const CONDITIONS = ['ABOVE', 'BELOW'];

// Create a new alert. Server actions take untrusted input, so only validated fields are stored.
export async function createAlert(params: {
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    expiresInDays?: number;
}) {
    const userId = await requireUserId();
    if (!alertsEnabled) throw new Error('价格预警功能需启用 OpenStock 预警服务 (OpenStock Cloud)');
    const inputSymbol = String(params?.symbol ?? '').trim().toUpperCase();
    const targetPrice = params?.targetPrice;
    const condition = params?.condition;
    const expiresInDays = params?.expiresInDays === undefined ? MAX_ALERT_DAYS : params.expiresInDays;

    if (!SYMBOL_PATTERN.test(inputSymbol)) throw new Error('无效的股票代码 (Invalid symbol)');
    if (!CONDITIONS.includes(condition)) throw new Error('无效的预警条件 (Invalid condition)');
    if (!getInstrumentCapabilities(inputSymbol).alerts) throw new Error('价格预警支持沪深、港股、台股和美股股票及 ETF');
    const symbol = identifyMarketAndCode(inputSymbol).normalizedSymbol;
    if (typeof targetPrice !== 'number' || !Number.isFinite(targetPrice) || targetPrice <= 0) throw new Error('目标价格必须为有限正数');
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_ALERT_DAYS) {
        throw new Error(`有效期必须为 1–${MAX_ALERT_DAYS} 天的整数`);
    }

    await connectToDatabase();
    if (await Alert.countDocuments({ userId, active: true, triggered: false, expiresAt: { $gt: new Date() } }) >= MAX_ACTIVE_ALERTS) {
        throw new Error(`最多可创建 ${MAX_ACTIVE_ALERTS} 条生效预警 (up to ${MAX_ACTIVE_ALERTS} active alerts)`);
    }

    try {
        // Only a fresh, verified source quote can seed the crossing. The client price is display-only.
        const observations = await getAlertObservations([symbol]).catch(() => ({} as Awaited<ReturnType<typeof getAlertObservations>>));
        const seed = observations[symbol];
        const newAlert = await Alert.create({
            userId, symbol, targetPrice, condition, active: true, triggered: false, mode: 'crossing',
            expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
            ...(seed ? { lastObservation: seed } : {}),
        });
        revalidatePath('/watchlist');
        return JSON.parse(JSON.stringify(newAlert));
    } catch (error) {
        console.error('Error creating alert:', error);
        throw new Error('创建预警失败');
    }
}

// Get all alerts for a user
export async function getUserAlerts() {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const alerts = await Alert.find({ userId }).sort({ createdAt: -1 });
        return JSON.parse(JSON.stringify(alerts));
    } catch (error) {
        console.error('Error fetching alerts:', error);
        return [];
    }
}

// Stop future sampling without deleting trigger or delivery evidence.
export async function pauseAlert(alertId: string) {
    const userId = await requireUserId();
    if (typeof alertId !== 'string' || !/^[a-f\d]{24}$/i.test(alertId)) throw new Error('无效的预警编号');
    await connectToDatabase();
    const result = await Alert.updateOne({ _id: alertId, userId, triggered: false }, { $set: { active: false } });
    revalidatePath('/watchlist');
    return { success: result.matchedCount > 0 };
}

// Delete an alert
export async function deleteAlert(alertId: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        await Alert.findOneAndDelete({ _id: alertId, userId });
        revalidatePath('/watchlist');
        return { success: true };
    } catch (error) {
        console.error('Error deleting alert:', error);
        throw new Error('删除预警失败');
    }
}
