import React from "react";
import { Building2, Calendar, Globe, MapPin, Users, Briefcase } from "lucide-react";
import Panel from "@/components/Panel";
import { getCompanyProfileData } from "@/lib/actions/company-profile.actions";

export default async function NativeCompanyProfile({ symbol }: { symbol: string }) {
    const profile = await getCompanyProfileData(symbol);

    return (
        <Panel title="公司概况" sub={`${profile.name} · ${profile.source ?? (profile.status === 'unsupported' ? '当前标的不支持公司档案查询' : '公司资料暂缺')}`}>
            <div className="flex flex-col gap-4 p-4 text-xs">
                {/* 核心标头与标签 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                    <div className="min-w-0">
                        <h3 className="truncate text-base font-bold text-foreground">
                            {profile.name}
                        </h3>
                        {profile.engName && (
                            <p className="mono text-[11px] text-faint truncate">
                                {profile.engName}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="pill mono px-2 py-0.5 text-[11px] font-semibold bg-brand-soft text-brand-ink border border-brand-ink/20">
                            {profile.industry}
                        </span>
                        <span className="pill mono px-2 py-0.5 text-[11px] font-semibold bg-white/5 text-faint">
                            {profile.exchange}
                        </span>
                    </div>
                </div>

                {/* 基本信息表格 (董事长、员工、上市日期、注册资本、官网、地址) */}
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {profile.listingDate && (
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-faint">
                                <Calendar className="size-3 text-brand-ink" /> 上市日期
                            </span>
                            <span className="mono font-semibold text-foreground">{profile.listingDate}</span>
                        </div>
                    )}
                    {profile.chairman && (
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-faint">
                                <Building2 className="size-3 text-brand-ink" /> 董事长 / 法人
                            </span>
                            <span className="font-semibold text-foreground truncate">{profile.chairman}</span>
                        </div>
                    )}
                    {profile.employees && (
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-faint">
                                <Users className="size-3 text-brand-ink" /> 员工人数
                            </span>
                            <span className="mono font-semibold text-foreground">{profile.employees}</span>
                        </div>
                    )}
                    {profile.regCapital && (
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-faint">
                                <Briefcase className="size-3 text-brand-ink" /> 注册资本
                            </span>
                            <span className="mono font-semibold text-foreground">{profile.regCapital}</span>
                        </div>
                    )}
                    {profile.website && (
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-faint">
                                <Globe className="size-3 text-brand-ink" /> 官方网址
                            </span>
                            <a
                                href={profile.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mono font-semibold text-brand-ink hover:underline truncate"
                            >
                                {profile.website.replace(/^https?:\/\//, '')}
                            </a>
                        </div>
                    )}
                    {profile.address && (
                        <div className="flex flex-col gap-1 rounded-lg bg-page/50 p-2.5">
                            <span className="flex items-center gap-1 text-[11px] text-faint">
                                <MapPin className="size-3 text-brand-ink" /> 办公注册地
                            </span>
                            <span className="font-medium text-foreground truncate" title={profile.address}>
                                {profile.address}
                            </span>
                        </div>
                    )}
                </div>

                {/* 公司详细简介 */}
                <div className="flex flex-col gap-1.5 rounded-lg bg-page/30 p-3 border border-line">
                    <span className="font-semibold text-foreground text-[12px]">企业简介</span>
                    <p className="text-[12px] leading-relaxed text-muted-foreground whitespace-pre-line">
                        {profile.intro}
                    </p>
                </div>

                {/* 核心主营业务 / 经营范围 */}
                {profile.businessScope && (
                    <div className="flex flex-col gap-1.5 rounded-lg bg-page/30 p-3 border border-line">
                        <span className="font-semibold text-foreground text-[12px]">主营业务与经营范围</span>
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                            {profile.businessScope}
                        </p>
                    </div>
                )}
            </div>
        </Panel>
    );
}
