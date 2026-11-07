'use client';

import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import InputField from "@/components/forms/InputField";
import ChoiceChips from "@/components/forms/ChoiceChips";
import { CountrySelectField } from "@/components/forms/CountrySelectField";
import { INVESTMENT_GOALS, PREFERRED_INDUSTRIES, RISK_TOLERANCE_OPTIONS } from "@/lib/constants";
import { updateProfile, type ProfileInput } from "@/lib/actions/profile.actions";

export default function ProfileForm({ initial }: { initial: ProfileInput }) {
    const router = useRouter();
    const { register, control, handleSubmit, formState: { errors, isSubmitting, isDirty }, reset } = useForm<ProfileInput>({
        defaultValues: initial,
        mode: 'onBlur',
    });

    const onSubmit = async (values: ProfileInput) => {
        const result = await updateProfile(values);
        if (!result.success) {
            toast.error('保存失败', { description: result.error });
            return;
        }
        toast.success('个人资料已保存');
        reset(values);
        router.refresh();
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5 p-4">
            <InputField
                name="name"
                label="姓名 / 昵称"
                placeholder="输入您的姓名或昵称"
                register={register}
                error={errors.name}
                validation={{ required: '请输入姓名', minLength: { value: 2, message: '姓名至少需要 2 个字符' } }}
            />
            <CountrySelectField name="country" label="国家 / 地区" control={control} error={errors.country} required />
            <ChoiceChips name="investmentGoals" label="投资目标" options={INVESTMENT_GOALS} control={control} />
            <ChoiceChips name="riskTolerance" label="风险偏好" options={RISK_TOLERANCE_OPTIONS} control={control} />
            <ChoiceChips name="preferredIndustry" label="偏好行业" options={PREFERRED_INDUSTRIES} control={control} />
            <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={isSubmitting || !isDirty} className="btn btn-primary">
                    {isSubmitting ? '正在保存...' : '保存修改'}
                </button>
                {!isDirty && <span className="text-[13px] text-faint">已是最新状态</span>}
            </div>
        </form>
    );
}
