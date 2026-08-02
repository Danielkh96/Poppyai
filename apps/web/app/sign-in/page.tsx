import { Info } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authCapabilities } from "@/lib/auth";
import { getAuthContext } from "@/lib/server/auth-context";

import { AuthPanel } from "./AuthPanel";

export const metadata = { title: "登录" };

export default async function SignInPage() {
  if (await getAuthContext()) redirect("/boards");

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="auth-card__notice">
          <Info size={15} aria-hidden="true" /> 使用你的 Siftloom 账号登录
        </p>
        <div className="auth-card__content">
          <Link href="/" className="auth-brand" aria-label="Siftloom 首页">
            <span aria-hidden="true">S</span>
          </Link>
          <header className="auth-card__header">
            <h1 id="sign-in-title">登录 Siftloom</h1>
            <p>欢迎回来，请登录以继续。</p>
          </header>
          <AuthPanel capabilities={authCapabilities} />
          <p className="auth-legal">
            继续即表示你同意 Siftloom 的<Link href="/trust">隐私与来源使用规范</Link>。
          </p>
        </div>
      </section>
    </main>
  );
}
