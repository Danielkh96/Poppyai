"use client";

import { ArrowRight, KeyRound, LoaderCircle, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/lib/use-hydrated";

interface AuthPanelProps {
  readonly capabilities: {
    readonly google: boolean;
    readonly magicLink: boolean;
    readonly password: boolean;
  };
}

type PasswordMode = "sign-in" | "sign-up";

export function AuthPanel({ capabilities }: AuthPanelProps) {
  const interactive = useHydrated();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("sign-up");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      if (capabilities.magicLink && !capabilities.password) {
        const result = await authClient.signIn.magicLink({
          email,
          callbackURL: "/boards"
        });
        if (result.error) throw new Error(result.error.message);
        setMessage("登录链接已发送，请检查邮箱。");
        return;
      }

      if (passwordMode === "sign-up") {
        const result = await authClient.signUp.email({
          email,
          name,
          password,
          callbackURL: "/boards"
        });
        if (result.error) throw new Error(result.error.message);
        window.location.assign("/boards");
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/boards"
        });
        if (result.error) throw new Error(result.error.message);
        window.location.assign("/boards");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  const noMethod =
    !capabilities.google && !capabilities.magicLink && !capabilities.password;

  return (
    <div className="auth-panel">
      {capabilities.google ? (
        <button
          className="auth-provider"
          type="button"
          disabled={!interactive || pending}
          suppressHydrationWarning
          onClick={() =>
            void authClient.signIn.social({ provider: "google", callbackURL: "/boards" })
          }
        >
          使用 Google 继续 <ArrowRight size={16} />
        </button>
      ) : null}

      {(capabilities.magicLink || capabilities.password) && capabilities.google ? (
        <div className="auth-divider">
          <span>或</span>
        </div>
      ) : null}

      {capabilities.password ? (
        <div className="auth-tabs" role="group" aria-label="本地认证方式">
          <button
            type="button"
            aria-pressed={passwordMode === "sign-up"}
            onClick={() => setPasswordMode("sign-up")}
          >
            创建账号
          </button>
          <button
            type="button"
            aria-pressed={passwordMode === "sign-in"}
            onClick={() => setPasswordMode("sign-in")}
          >
            密码登录
          </button>
        </div>
      ) : null}

      {capabilities.magicLink || capabilities.password ? (
        <form onSubmit={submit} className="auth-form">
          {capabilities.password && passwordMode === "sign-up" ? (
            <label>
              昵称
              <input
                required
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="你的名字"
              />
            </label>
          ) : null}
          <label>
            邮箱
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {capabilities.password ? (
            <label>
              密码
              <input
                required
                minLength={12}
                type="password"
                autoComplete={
                  passwordMode === "sign-up" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 12 个字符"
              />
            </label>
          ) : null}
          <button
            className="auth-submit"
            type="submit"
            disabled={!interactive || pending}
            suppressHydrationWarning
          >
            {pending ? <LoaderCircle className="spin" size={17} /> : <Mail size={17} />}
            {capabilities.password
              ? passwordMode === "sign-up"
                ? "创建并进入工作区"
                : "登录"
              : "发送登录链接"}
          </button>
        </form>
      ) : null}

      {noMethod ? (
        <div className="auth-unavailable" role="status">
          <KeyRound size={18} />
          <p>认证服务尚未配置。请配置 Google 或邮件发送服务后重试。</p>
        </div>
      ) : null}

      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
      {capabilities.password ? (
        <p className="local-auth-note">密码认证仅在本地开发和自动化测试中启用。</p>
      ) : null}
    </div>
  );
}
