import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Siftloom — 可追溯的视觉 AI 工作台",
    template: "%s · Siftloom"
  },
  description: "在无限画布上整理来源，并从显式连接的上下文生成可追溯回答。",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
