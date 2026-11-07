"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAlert } from "@/lib/actions/alert.actions";
import { alertsEnabled } from "@/lib/market-data";
import { formatPrice } from "@/lib/utils";

type AlertRow = {
    _id: string;
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    triggered?: boolean;
    active?: boolean;
    expiresAt?: string;
};

const statusOf = (alert: AlertRow) => {
    if (alert.triggered) return { label: '已触发', className: 'pill is-brand' };
    if (!alertsEnabled) return { label: '已暂停', className: 'pill' };
    if (alert.expiresAt && new Date(alert.expiresAt) < new Date()) return { label: '已过期', className: 'pill' };
    if (alert.active === false) return { label: '已暂停', className: 'pill' };
    return { label: '监控中', className: 'pill is-up' };
};

export default function AlertsPanel({ alerts }: { alerts: AlertRow[] }) {
    const router = useRouter();
    const [pendingId, setPendingId] = useState<string | null>(null);

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
                <p className="max-w-64 text-[13px]">邮件价格预警功能即将上线。</p>
                <Link href="/#data" className="btn btn-ghost mt-2">了解详情</Link>
            </div>
        );
    }

    if (alerts.length === 0) {
        return (
            <div className="empty-state py-10">
                <span className="empty-icon"><BellRing className="size-5" /></span>
                <h3>暂无价格预警</h3>
                <p className="max-w-60 text-[13px]">在自选表格中点击铃铛图标，或在股票详情页点击“设置预警”，触发时将通知您。</p>
            </div>
        );
    }

    return (
        <>
            {!alertsEnabled && (
                <p className="px-3 pt-3 pb-1 text-[12.5px] text-faint">
                    预警功能已升级至 <Link href="/#data" className="text-brand-ink hover:underline">OpenStock Cloud</Link>，当前处于暂停状态。
                </p>
            )}
            <ul className="row-list">
                {alerts.map((alert) => {
                    const status = statusOf(alert);
                    return (
                        <li key={alert._id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <p className="mono font-semibold text-foreground">{alert.symbol}</p>
                                <p className="num truncate text-[12.5px] text-faint">
                                    {alert.condition === 'ABOVE' ? '高于' : '低于'} {formatPrice(alert.targetPrice)}
                                    {alert.expiresAt && !alert.triggered && ` · 截止 ${new Date(alert.expiresAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`}
                                </p>
                            </div>
                            <span className={status.className}>{status.label}</span>
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
