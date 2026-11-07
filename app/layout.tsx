import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import {Toaster} from "@/components/ui/sonner";
import OntoLaunchCard from "@/components/OntoLaunchCard";
import { cookies } from "next/headers";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "OpenStock",
  description: "OpenStock 是面向所有人的开源金融市场终端。实时跟踪行情报价、配置个性化价格预警、深度解析公司财务与指标 — 自由开放，永久开源。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const colorScheme = cookieStore.get('openstock-color-scheme')?.value || 'cn';

  return (
    <html lang="zh-CN" className="dark" data-color-scheme={colorScheme}>
      <body
        className={`${jakarta.variable} ${plexMono.variable} font-sans antialiased`}
      >
        {children}
        <Toaster />
        <OntoLaunchCard />
        <Analytics />
      </body>
    </html>
  );
}
