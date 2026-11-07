'use client';

import { useForm } from "react-hook-form";
import { toast } from "sonner";
import InputField from "@/components/forms/InputField";
import PasswordRequirements from "@/components/forms/PasswordRequirements";
import { PASSWORD_VALIDATION } from "@/lib/constants";
import { changePassword } from "@/lib/actions/profile.actions";

type PasswordInput = { currentPassword: string; newPassword: string };

export default function PasswordForm() {
    const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<PasswordInput>({
        defaultValues: { currentPassword: '', newPassword: '' },
        mode: 'onBlur',
    });

    const onSubmit = async (values: PasswordInput) => {
        const result = await changePassword(values);
        if (!result.success) {
            toast.error('密码修改失败', { description: result.error });
            return;
        }
        toast.success('密码修改成功', { description: '其他设备已自动登出。' });
        reset();
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 p-4">
            <InputField
                name="currentPassword"
                label="当前密码"
                placeholder="请输入当前密码"
                type="password"
                register={register}
                error={errors.currentPassword}
                validation={{ required: '请输入当前密码' }}
            />
            <div className="flex flex-col gap-2">
                <InputField
                    name="newPassword"
                    label="新密码"
                    placeholder="至少 8 位字符"
                    type="password"
                    register={register}
                    error={errors.newPassword}
                    validation={PASSWORD_VALIDATION}
                />
                <PasswordRequirements password={watch('newPassword') ?? ''} />
            </div>
            <button type="submit" disabled={isSubmitting} className="btn btn-ghost self-start">
                {isSubmitting ? '正在修改...' : '修改密码'}
            </button>
        </form>
    );
}
