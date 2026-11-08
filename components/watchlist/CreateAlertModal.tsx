"use client";

import React, { useId, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createAlert } from "@/lib/actions/alert.actions";
import { alertsEnabled } from "@/lib/market-data";
import { getInstrumentCapabilities } from "@/lib/market/capabilities";
import { identifyMarketAndCode } from "@/lib/market/instrument";
import { formatPrice, cn } from "@/lib/utils";
import { toast } from "sonner";

interface CreateAlertModalProps {
    symbol: string;
    currentPrice?: number | null;
    currency?: string;
    children?: React.ReactNode;
    onAlertCreated?: () => void;
}

const CONDITIONS = [
    { value: 'ABOVE', label: '向上穿越' },
    { value: 'BELOW', label: '向下穿越' },
] as const;

export default function CreateAlertModal({ symbol, currentPrice, currency = identifyMarketAndCode(symbol).currency, children, onAlertCreated }: CreateAlertModalProps) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
    const [targetPrice, setTargetPrice] = useState('');
    const [expiresInDays, setExpiresInDays] = useState('90');
    const [loading, setLoading] = useState(false);
    const [priceError, setPriceError] = useState('');
    const [expiryError, setExpiryError] = useState('');
    const [serverError, setServerError] = useState('');

    const target = Number(targetPrice);
    const hasPrice = typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0;
    const distance = hasPrice && targetPrice !== '' && Number.isFinite(target) ? ((target - currentPrice!) / currentPrice!) * 100 : null;
    const alreadyMet = distance !== null && (condition === 'ABOVE' ? distance <= 0 : distance >= 0);
    const supported = getInstrumentCapabilities(symbol).alerts;
    const validatePrice = () => !targetPrice.trim() ? '请填写目标价格。' : !Number.isFinite(target) || target <= 0 ? '目标价格必须为有限正数。' : '';
    const validateExpiry = () => !expiresInDays.trim() || !Number.isInteger(Number(expiresInDays)) || Number(expiresInDays) < 1 || Number(expiresInDays) > 90 ? '有效期必须为 1–90 天的整数。' : '';

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) {
            setTargetPrice(hasPrice ? String(currentPrice) : '');
            setExpiresInDays('90');
            setPriceError('');
            setExpiryError('');
            setServerError('');
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (loading) return;
        const priceMessage = validatePrice();
        const expiryMessage = validateExpiry();
        setPriceError(priceMessage);
        setExpiryError(expiryMessage);
        setServerError('');
        if (priceMessage || expiryMessage) {
            const field = e.currentTarget.elements.namedItem(priceMessage ? 'targetPrice' : 'expiresInDays');
            if (field instanceof HTMLInputElement) field.focus();
            return;
        }
        setLoading(true);
        try {
            await createAlert({ symbol, targetPrice: target, condition, expiresInDays: Number(expiresInDays) });
            toast.success(`穿越预警已创建：${symbol} ${condition === 'ABOVE' ? '向上' : '向下'} ${formatPrice(target, currency)}`);
            setOpen(false);
            onAlertCreated?.();
        } catch (error) {
            setServerError(error instanceof Error ? error.message : '创建预警失败，请稍后重试。');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {children && <DialogTrigger asChild>{children}</DialogTrigger>}
            <DialogContent className="sm:max-w-[440px] gap-5 max-h-[90dvh] overflow-y-auto">
                {alertsEnabled && supported ? (
                    <>
                        <div>
                            <p className="kicker text-brand-ink">价格穿越预警</p>
                            <DialogTitle className="mt-1 text-xl font-bold tracking-tight mono">{symbol}</DialogTitle>
                            <DialogDescription className="mt-1 text-[13px] text-faint">
                                每 5 分钟采样，比较相邻有效报价；向上由低于目标变为达到或高于，向下则相反。仅触发一次，盘中短暂穿越可能漏检。
                            </DialogDescription>
                        </div>
                        <form method="post" noValidate onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={loading}>
                            <fieldset>
                                <legend className="form-label mb-2">穿越方向（必选）</legend>
                                <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-page p-1">
                                    {CONDITIONS.map(({ value, label }) => (
                                        <label key={value} htmlFor={`${id}-${value}`} className={cn('flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[9px] font-semibold', condition === value ? 'bg-hover text-foreground' : 'text-faint')}>
                                            <input id={`${id}-${value}`} name="condition" type="radio" value={value} checked={condition === value} onChange={() => setCondition(value)} required />
                                            {label}
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                            <div className="flex flex-col gap-2">
                                <label htmlFor={`${id}-price`} className="form-label">目标价格 · {currency}（必填）</label>
                                <input
                                    id={`${id}-price`} name="targetPrice" type="number" inputMode="decimal" step="any" min={Number.MIN_VALUE} required autoFocus
                                    value={targetPrice}
                                    onChange={(e) => { setTargetPrice(e.target.value); setPriceError(''); }}
                                    onBlur={() => setPriceError(validatePrice())}
                                    aria-invalid={priceError ? true : undefined}
                                    aria-describedby={`${id}-price-help ${id}-price-error`}
                                    className="num h-12 w-full rounded-[11px] border border-line bg-page px-3 text-lg font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-brand"
                                />
                                <p id={`${id}-price-help`} className="num text-[12.5px] text-faint">
                                    {hasPrice ? `页面参考价 ${formatPrice(currentPrice!, currency)}${distance === null ? '' : ` · 距参考价 ${distance > 0 ? '+' : ''}${distance.toFixed(2)}%`}` : '页面暂无参考价格。'}
                                    {alreadyMet && ' 参考价已达到目标，仍需之后观察到一次真实穿越才会触发。'}
                                </p>
                                <p id={`${id}-price-error`} aria-live="polite" className="text-[12.5px] text-warn">{priceError && `错误：${priceError}`}</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label htmlFor={`${id}-expiry`} className="form-label">有效期 · 天（必填，1–90）</label>
                                <input
                                    id={`${id}-expiry`} name="expiresInDays" type="number" inputMode="numeric" min="1" max="90" step="1" required
                                    value={expiresInDays}
                                    onChange={(e) => { setExpiresInDays(e.target.value); setExpiryError(''); }}
                                    onBlur={() => setExpiryError(validateExpiry())}
                                    aria-invalid={expiryError ? true : undefined} aria-describedby={`${id}-expiry-error`}
                                    className="num h-12 w-full rounded-[11px] border border-line bg-page px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-brand"
                                />
                                <p id={`${id}-expiry-error`} aria-live="polite" className="text-[12.5px] text-warn">{expiryError && `错误：${expiryError}`}</p>
                            </div>
                            <p className="text-[12px] leading-relaxed text-faint">
                                创建时尝试用新鲜报价初始化；没有有效报价时，首个有效采样只作基准。仅使用已验证交易时段内产生、来源时间不超过 2 分钟的报价。需服务器持续运行 Inngest 任务及配置邮件；页面参考价可能来自缓存，邮件不保证送达。
                            </p>
                            <p role="alert" className="text-[13px] text-warn">{serverError}</p>
                            <button type="submit" disabled={loading} className="btn btn-primary min-h-12">
                                {loading ? '正在设置预警...' : '设置穿越预警'}
                            </button>
                        </form>
                    </>
                ) : (
                    <div>
                        <p className="kicker text-brand-ink">OpenStock 预警</p>
                        <DialogTitle className="mt-1 text-xl font-bold tracking-tight">{supported ? '价格预警当前未启用' : '此标的暂不支持价格预警'}</DialogTitle>
                        <DialogDescription className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                            {supported ? '当前为缓存行情模式，不运行价格穿越检测。启用实时部署后，还需持续运行服务器 Inngest 任务、有效交易日历及邮件配置。' : '目前支持沪深、港股、台股和美股股票及 ETF；仅在有已验证日历和新鲜交易报价时检测。'}
                        </DialogDescription>
                        <div className="mt-5 flex gap-2">
                            <Link href="/#data" className="btn btn-primary min-h-12 flex-1">查看详情</Link>
                            <Link href="/#self-host" className="btn btn-ghost min-h-12">私有部署</Link>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
