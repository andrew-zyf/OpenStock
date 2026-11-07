"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createAlert } from "@/lib/actions/alert.actions";
import { alertsEnabled } from "@/lib/market-data";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface CreateAlertModalProps {
    symbol: string;
    currentPrice?: number | null;
    currency?: string;
    children?: React.ReactNode;
    onAlertCreated?: () => void;
}

const CONDITIONS = [
    { value: 'ABOVE', label: '上涨高于' },
    { value: 'BELOW', label: '下跌低于' },
] as const;

export default function CreateAlertModal({ symbol, currentPrice, currency = 'USD', children, onAlertCreated }: CreateAlertModalProps) {
    const [open, setOpen] = useState(false);
    const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
    const [targetPrice, setTargetPrice] = useState('');
    const [loading, setLoading] = useState(false);

    const target = parseFloat(targetPrice);
    const hasPrice = !!currentPrice && currentPrice > 0;
    const distance = hasPrice && Number.isFinite(target) ? ((target - currentPrice!) / currentPrice!) * 100 : null;
    const alreadyMet = distance !== null && (condition === 'ABOVE' ? distance <= 0 : distance >= 0);

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) setTargetPrice(hasPrice ? currentPrice!.toFixed(2) : '');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await createAlert({ symbol, targetPrice: target, condition });
            toast.success(`预警已创建：${symbol} ${condition === 'ABOVE' ? '高于' : '低于'} ${formatPrice(target, currency)}`);
            setOpen(false);
            onAlertCreated?.();
        } catch (error) {
            console.error(error);
            toast.error("创建预警失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {children && <DialogTrigger asChild>{children}</DialogTrigger>}
            <DialogContent className="sm:max-w-[420px] gap-5">
                {alertsEnabled ? (
                    <>
                        <div>
                            <p className="kicker text-brand-ink">价格预警</p>
                            <DialogTitle className="mt-1 text-xl font-bold tracking-tight mono">{symbol}</DialogTitle>
                            <DialogDescription className="mt-1 text-[13px] text-faint">
                                当价格达到目标时将发送邮件提醒。每 5 分钟检测一次，90 天后自动到期。
                            </DialogDescription>
                        </div>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-page p-1" role="radiogroup" aria-label="触发条件">
                                {CONDITIONS.map(({ value, label }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        role="radio"
                                        aria-checked={condition === value}
                                        onClick={() => setCondition(value)}
                                        className={cn(
                                            'h-9 rounded-[9px] font-semibold transition-colors',
                                            condition === value ? 'bg-hover text-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.06)]' : 'text-faint hover:text-foreground',
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <label className="flex flex-col gap-2">
                                <span className="form-label">目标价格</span>
                                <span className="flex h-12 items-center gap-2 rounded-[11px] border border-line bg-page px-3 focus-within:border-brand">
                                    <span className="mono text-faint">{currency}</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        min="0.01"
                                        required
                                        autoFocus
                                        value={targetPrice}
                                        onChange={(e) => setTargetPrice(e.target.value)}
                                        className="num w-full bg-transparent text-lg font-semibold text-foreground outline-none"
                                    />
                                </span>
                                <span className={cn('num text-[12.5px]', alreadyMet ? 'text-warn' : 'text-faint')}>
                                    {!hasPrice
                                        ? '暂无当前价格'
                                        : alreadyMet
                                            ? `当前已${condition === 'ABOVE' ? '高于' : '低于'}此目标 — 下次轮询时将触发`
                                            : `当前价 ${formatPrice(currentPrice!, currency)}${distance === null ? '' : ` · 距当前 ${distance > 0 ? '+' : ''}${distance.toFixed(2)}%`}`}
                                </span>
                            </label>

                            <button type="submit" disabled={loading || !(target > 0)} className="btn btn-primary h-11">
                                {loading ? '正在设置预警...' : '设置预警'}
                            </button>
                        </form>
                    </>
                ) : (
                    // Alerts are an OpenStock Cloud feature; the free hourly site points people to it
                    <div>
                        <p className="kicker text-brand-ink">OpenStock 预警</p>
                        <DialogTitle className="mt-1 text-xl font-bold tracking-tight">云端价格预警服务</DialogTitle>
                        <DialogDescription className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                            OpenStock 提供邮件预警和实时行情服务。本地私有化部署已全面支持。
                        </DialogDescription>
                        <div className="mt-5 flex gap-2">
                            <Link href="/#data" className="btn btn-primary h-11 flex-1">查看详情</Link>
                            <Link href="/#self-host" className="btn btn-ghost h-11">私有部署</Link>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
