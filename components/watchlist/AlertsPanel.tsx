"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAlert, pauseAlert } from "@/lib/actions/alert.actions";
import { alertsEnabled } from "@/lib/market-data";
import { formatPrice } from "@/lib/utils";
import { identifyMarketAndCode } from "@/lib/market/instrument";
import type { AlertMode, AlertObservation, AlertTriggerEvent, AlertDelivery } from "@/lib/alerts/evaluation";

type AlertRow = {
    _id: string;
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    triggered?: boolean;
    active?: boolean;
    expiresAt?: string;
    mode?: AlertMode;
    lastObservation?: AlertObservation;
    triggerEvent?: AlertTriggerEvent;
    delivery?: AlertDelivery;
};

const alertMoney = (price: number, symbol: string) => symbol.startsWith('BINANCE:')
    ? `${price.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDT`
    : formatPrice(price, identifyMarketAndCode(symbol).currency);

const statusOf = (alert: AlertRow) => {
    if (alert.triggered) {
        const labels = { pending: '已触发 · 邮件待确认', sent: '已触发 · 邮件已提交', skipped: '已触发 · 邮件未发送', failed: '已触发 · 邮件失败' };
        return { label: alert.delivery ? labels[alert.delivery.status] : '已触发 · 旧记录无投递状态', className: 'pill is-brand' };
    }
    if (!alertsEnabled) return { label: '已暂停', className: 'pill' };
    if (alert.expiresAt && new Date(alert.expiresAt) < new Date()) return { label: '已过期', className: 'pill' };
    if (alert.active === false) return { label: '已暂停', className: 'pill' };
    return { label: alert.mode === 'crossing' && !alert.lastObservation ? '待首个有效采样' : '待任务检测', className: 'pill is-up' };
};

export default function AlertsPanel({ alerts }: { alerts: AlertRow[] }) {
    const router = useRouter();
    const [pendingId, setPendingId] = useState<string | null>(null);

    const handlePause = async (alert: AlertRow) => {
        setPendingId(alert._id);
        try {
            const result = await pauseAlert(alert._id);
            if (result.success) toast.success('已停用后续检测，触发与投递记录保留');
            else toast.error('预警已触发或不存在，请刷新核对');
            router.refresh();
        } catch { toast.error('停用预警失败'); }
        finally { setPendingId(null); }
    };

    const handleDelete = async (alert: AlertRow) => {
        setPendingId(alert._id);
        try {
            await deleteAlert(alert._id);
            toast.success(`已删除 ${alert.symbol} 的价格预警`);
            router.refresh();
        } catch {
            toast.error("删除预警失败");
        } finally {
            setPendingId(null);
        }
    };

    if (alerts.length === 0 && !alertsEnabled) {
        return (
            <div className="empty-state py-10">
                <span className="empty-icon"><BellRing className="size-5" /></span>
                <h3>云端价格预警</h3>
                <p className="max-w-64 text-[13px]">缓存行情模式下预警已暂停；实时部署还需服务器检测任务、已验证日历和邮件配置。</p>
                <Link href="/#data" className="btn btn-ghost mt-2">了解详情</Link>
            </div>
        );
    }

    if (alerts.length === 0) {
        return (
            <div className="empty-state py-10">
                <span className="empty-icon"><BellRing className="size-5" /></span>
                <h3>暂无价格预警</h3>
                <p className="max-w-60 text-[13px]">在自选或股票详情设置穿越预警。服务器每 5 分钟采样，需已验证日历、新鲜报价及运行中的 Inngest 任务；配置邮件后尝试发送。</p>
            </div>
        );
    }

    return (
        <>
            {!alertsEnabled && (
                <p className="px-3 pt-3 pb-1 text-[12.5px] text-faint">
                    缓存行情模式下预警已暂停。<Link href="/#data" className="text-brand-ink hover:underline">实时部署</Link>还需运行服务器 Inngest 检测任务及配置邮件。
                </p>
            )}
            <p className="px-3 pt-3 pb-1 text-[12px] leading-relaxed text-faint">
                每 5 分钟采样，有效期最长 90 天。股票只比较已验证交易时段内的有效报价，旧版加密货币按 24/7 检测；短暂穿越可能漏检。“待任务检测”不代表服务器任务在线。触发后不重复触发，邮件失败或未配置时不自动重发。
            </p>
            <ul className="row-list" aria-label="价格预警">
                {alerts.map((alert) => {
                    const status = statusOf(alert);
                    return (
                        <li key={alert._id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="mono font-semibold text-foreground">{alert.symbol}</p>
                                <p className="num truncate text-[12.5px] text-faint">
                                    {alert.mode === 'crossing' ? (alert.condition === 'ABOVE' ? '向上穿越' : '向下穿越') : (alert.condition === 'ABOVE' ? '旧版：达到或高于' : '旧版：达到或低于')} {alertMoney(alert.targetPrice, alert.symbol)}
                                    {alert.expiresAt && !alert.triggered && ` · 截止 ${new Date(alert.expiresAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
                                </p>
                                {alert.triggerEvent && <p className="break-words text-[12px] text-faint">触发采样 {alertMoney(alert.triggerEvent.price, alert.symbol)} · {alert.triggerEvent.source} · {alert.triggerEvent.asOf}</p>}
                                {alert.delivery?.reason && <p className="text-[12px] text-warn">{alert.delivery.reason === 'email-not-configured' ? '邮件未配置，未发送' : alert.delivery.reason === 'owner-email-missing' ? '账户缺少邮箱，未发送' : '邮件发送失败，可在服务端日志中检查'}</p>}
                                {alert.delivery?.status === 'pending' && alert.delivery.attemptedAt && <p className="text-[12px] text-warn">已尝试投递但结果未确认；为避免重复邮件，不自动重发。</p>}
                            </div>
                            <span className={status.className}>{status.label}</span>
                            {!alert.triggered && alert.active !== false && <button type="button" className="btn min-h-12" disabled={pendingId === alert._id} onClick={() => void handlePause(alert)} aria-label={`停用 ${alert.symbol} 的预警`}>停用</button>}
                            <button
                                type="button"
                                onClick={() => handleDelete(alert)}
                                disabled={pendingId === alert._id}
                                className="icon-btn is-danger"
                                title="删除预警"
                                aria-label={`删除 ${alert.symbol} 的预警`}
                            >
                                <Trash2 />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </>
    );
}
