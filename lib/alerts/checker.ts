import { Alert } from '@/database/models/alert.model';
import { connectToDatabase } from '@/database/mongoose';
import { alertsEnabled } from '@/lib/market-data';
import { identifyMarketAndCode } from '@/lib/market/instrument';
import { sendStockAlertEmail } from '@/lib/nodemailer';
import { getAlertObservations, isLegacyCryptoSymbol, validateAlertQuote } from './quotes';
import { evaluateSample, type AlertCondition, type AlertMode, type AlertObservation, type AlertTriggerEvent, type AlertDelivery } from './evaluation';

export type SampledAlert = {
    _id: unknown;
    symbol: string;
    userId: string;
    targetPrice: number;
    condition: AlertCondition;
    mode?: AlertMode;
    lastObservation?: AlertObservation;
};

/** Compare-and-set prevents duplicate and out-of-order jobs from changing a newer observation. */
export async function recordAlertSample(alert: SampledAlert, sample: AlertObservation, now: Date): Promise<boolean> {
    const legacyCrypto = alert.mode !== 'crossing' && isLegacyCryptoSymbol(alert.symbol);
    if (!validateAlertQuote(alert.symbol, { ...sample, priceBasis: 'last-trade' }, now, legacyCrypto)) return false;
    const decision = evaluateSample(alert, sample);
    if (decision === 'ignore') return false;
    const previous = alert.lastObservation;
    const event: AlertTriggerEvent = {
        ...sample,
        id: `${String(alert._id)}:trigger`,
        direction: alert.condition,
        observedAt: now.toISOString(),
        ...(previous ? { previousObservation: previous } : {}),
    };
    const claimed = await Alert.findOneAndUpdate({
        _id: alert._id,
        active: true,
        triggered: false,
        expiresAt: { $gt: now },
        'triggerEvent.id': { $exists: false },
        ...(previous ? {
            'lastObservation.asOf': previous.asOf,
            'lastObservation.price': previous.price,
            'lastObservation.source': previous.source,
        } : { lastObservation: { $exists: false } }),
    }, { $set: {
        lastObservation: sample,
        ...(decision === 'trigger' ? {
            triggered: true,
            active: false,
            triggerEvent: event,
            delivery: { status: 'pending' },
        } : {}),
    } });
    return decision === 'trigger' && Boolean(claimed);
}

/** A send claim is never automatically retried: SMTP cannot guarantee exactly-once delivery. */
export async function deliverPendingAlert(alertId: string, now = new Date()): Promise<void> {
    const claimed = await Alert.findOneAndUpdate({
        _id: alertId,
        triggered: true,
        'triggerEvent.id': { $exists: true },
        'delivery.status': 'pending',
        'delivery.attemptedAt': { $exists: false },
    }, { $set: { 'delivery.attemptedAt': now.toISOString() } }, { new: true });
    if (!claimed?.triggerEvent) return;

    let delivery: AlertDelivery;
    try {
        if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASSWORD) {
            delivery = { status: 'skipped', reason: 'email-not-configured' };
        } else {
            const mongoose = await connectToDatabase();
            const db = mongoose.connection.db;
            if (!db) throw new Error('No DB Connection');
            const user = await db.collection('user').findOne<{ email?: string }>(
                mongoose.isValidObjectId(claimed.userId)
                    ? { $or: [{ id: claimed.userId }, { _id: new mongoose.Types.ObjectId(claimed.userId) }] }
                    : { id: claimed.userId }
            );
            if (!user?.email) {
                delivery = { status: 'skipped', reason: 'owner-email-missing' };
            } else {
                const event = claimed.triggerEvent;
                const result = await sendStockAlertEmail({
                    email: user.email,
                    symbol: claimed.symbol,
                    currentPrice: event.price,
                    targetPrice: claimed.targetPrice,
                    condition: event.direction,
                    currency: identifyMarketAndCode(claimed.symbol).currency,
                    asOf: event.asOf,
                    source: event.source,
                });
                delivery = result.status === 'sent'
                    ? { status: 'sent', messageId: result.messageId }
                    : { status: 'skipped', reason: 'email-not-configured' };
            }
        }
    } catch (error) {
        // Persist the trigger even if SMTP fails. Raw provider errors stay in server logs.
        console.error(`Alert delivery failed for ${alertId}`, error);
        delivery = { status: 'failed', reason: 'email-send-failed' };
    }
    // If this write fails after SMTP accepts a message, pending + attemptedAt means delivery is
    // uncertain. Leave it inspectable; re-sending on a job retry could duplicate the email.
    await Alert.updateOne({
        _id: alertId,
        'triggerEvent.id': claimed.triggerEvent.id,
        'delivery.status': 'pending',
        'delivery.attemptedAt': now.toISOString(),
    }, { $set: { delivery: { ...delivery, attemptedAt: now.toISOString(), completedAt: new Date().toISOString() } } });
}

export async function runAlertCheck() {
    if (!alertsEnabled) return { status: 'disabled' as const, processed: 0, triggered: 0 };
    await connectToDatabase();
    const alerts = await Alert.find({ active: true, triggered: false, expiresAt: { $gt: new Date() } }).lean();
    const symbols = [...new Set(alerts.map(alert => alert.symbol))];
    const legacyCryptoSymbols = [...new Set(alerts.filter(alert => alert.mode !== 'crossing' && isLegacyCryptoSymbol(alert.symbol)).map(alert => alert.symbol))];
    const observations = symbols.length ? await getAlertObservations(symbols, undefined, legacyCryptoSymbols) : {};
    let triggered = 0;
    for (const alert of alerts) {
        const sample = observations[alert.symbol];
        if (sample && await recordAlertSample(alert, sample, new Date())) triggered++;
    }
    // Also resume events persisted before a previous run stopped, provided no send was attempted.
    const pending = await Alert.find({
        triggered: true,
        'triggerEvent.id': { $exists: true },
        'delivery.status': 'pending',
        'delivery.attemptedAt': { $exists: false },
    }).select('_id').lean();
    for (const alert of pending) await deliverPendingAlert(String(alert._id));
    return { status: 'checked' as const, processed: alerts.length, triggered };
}
