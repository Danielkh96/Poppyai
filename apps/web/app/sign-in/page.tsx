import Link from "next/link";
import { redirect } from "next/navigation";

import { authCapabilities } from "@/lib/auth";
import { getAuthContext } from "@/lib/server/auth-context";

import { AuthPanel } from "./AuthPanel";

export const metadata = { title: "登录" };

export default async function SignInPage() {
  if (await getAuthContext()) redirect("/boards");

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="wordmark" aria-label="Siftloom 首页">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>Siftloom</span>
        </Link>
        <div>
          <span className="eyebrow">Your research, in context</span>
          <h1>回到你的视觉工作区。</h1>
          <p>Board、来源与生成结果都留在各自的租户边界内，并由服务端逐次验证会话。</p>
        </div>
        <small>M1 · Identity & board lifecycle</small>
      </section>
      <section className="auth-card" aria-labelledby="sign-in-title">
        <span className="auth-card__index">01 / ACCESS</span>
        <h2 id="sign-in-title">登录 Siftloom</h2>
        <p>继续整理来源，或创建第一个 Board。</p>
        <AuthPanel capabilities={authCapabilities} />
      </section>
    </main>
  );
}
