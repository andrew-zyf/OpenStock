'use client';

import { useEffect, useState } from "react";

const COOKIE_NAME = 'openstock-color-scheme';

export default function ColorSchemeToggle() {
    const [scheme, setScheme] = useState<'cn' | 'intl'>('cn');

    useEffect(() => {
        // Read current attribute or cookie
        const current = (document.documentElement.getAttribute('data-color-scheme') as 'cn' | 'intl') || 'cn';
        setScheme(current);
    }, []);

    const toggle = () => {
        const next = scheme === 'cn' ? 'intl' : 'cn';
        setScheme(next);
        document.documentElement.setAttribute('data-color-scheme', next);
        document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=31536000; samesite=lax`;
    };

    return (
        <button
            type="button"
            onClick={toggle}
            className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-page/60 px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            title="点击切换全站涨跌颜色习惯 (红涨绿跌 / 绿涨红跌)"
            aria-label="切换涨跌配色"
        >
            <span
                className="size-2 rounded-full"
                style={{ backgroundColor: scheme === 'cn' ? 'oklch(0.70 0.162 25)' : 'oklch(0.70 0.164 150)' }}
            />
            <span>{scheme === 'cn' ? '红涨绿跌' : '绿涨红跌'}</span>
        </button>
    );
}
