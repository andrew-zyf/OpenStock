export type AlertCondition = 'ABOVE' | 'BELOW';
export type AlertMode = 'crossing' | 'legacy-threshold';
export type AlertObservation = { price: number; asOf: string; source: string };
export type AlertTriggerEvent = AlertObservation & {
    id: string;
    direction: AlertCondition;
    observedAt: string;
    previousObservation?: AlertObservation;
};
export type AlertDelivery = {
    status: 'pending' | 'sent' | 'skipped' | 'failed';
    attemptedAt?: string;
    completedAt?: string;
    reason?: string;
    messageId?: string;
};

// Source time, never HTTP fetch time. A five-minute schedule does not make an old quote fresh.
export const MAX_ALERT_QUOTE_AGE_MS = 120_000;
export const MAX_ALERT_DAYS = 90;
export const MAX_ACTIVE_ALERTS = 50;

export type AlertQuote = {
    price: number;
    source: string;
    asOf?: string;
    priceBasis?: 'last-trade' | 'previous-close';
};
export type AlertSession = {
    isTrading: boolean;
    calendarStatus: 'verified' | 'unverified';
    exchangeDate: string;
};

export function validObservation(
    quote: AlertQuote | null | undefined,
    session: AlertSession,
    sourceSession: AlertSession,
    now: Date,
): AlertObservation | null {
    // A cron run at the closing/lunch boundary may still observe a real trade just before it.
    if (session.calendarStatus !== 'verified'
        || !sourceSession.isTrading || sourceSession.calendarStatus !== 'verified'
        || sourceSession.exchangeDate !== session.exchangeDate) return null;
    return freshObservation(quote, now);
}

/** Continuous legacy crypto needs no exchange calendar; never fabricate a verified one. */
export function freshObservation(quote: AlertQuote | null | undefined, now: Date): AlertObservation | null {
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0
        || quote.priceBasis !== 'last-trade' || !quote.source?.trim() || !quote.asOf) return null;
    const timestamp = Date.parse(quote.asOf);
    const age = now.getTime() - timestamp;
    if (!Number.isFinite(age) || age < 0 || age > MAX_ALERT_QUOTE_AGE_MS) return null;
    return { price: quote.price, asOf: new Date(timestamp).toISOString(), source: quote.source };
}

/** No mode on a stored alert means its original threshold semantics, without a migration. */
export function evaluateSample(
    alert: { mode?: AlertMode; targetPrice: number; condition: AlertCondition; lastObservation?: AlertObservation },
    sample: AlertObservation,
): 'ignore' | 'observe' | 'trigger' {
    if (!Number.isFinite(alert.targetPrice) || alert.targetPrice <= 0
        || !['ABOVE', 'BELOW'].includes(alert.condition)) return 'ignore';
    const previous = alert.lastObservation;
    if (previous && Date.parse(sample.asOf) <= Date.parse(previous.asOf)) return 'ignore';
    const meets = alert.condition === 'ABOVE' ? sample.price >= alert.targetPrice : sample.price <= alert.targetPrice;
    if (alert.mode !== 'crossing') return meets ? 'trigger' : 'observe';
    if (!previous) return 'observe';
    const crosses = alert.condition === 'ABOVE' ? previous.price < alert.targetPrice : previous.price > alert.targetPrice;
    return crosses && meets ? 'trigger' : 'observe';
}
