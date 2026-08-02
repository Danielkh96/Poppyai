"use client";

import { ArrowRight, KeyRound, LoaderCircle } from "lucide-react";
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
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("sign-in");
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
          <span className="auth-provider__mark" aria-hidden="true">
            G
          </span>
          使用 Google 继续
        </button>
      ) : null}

      {(capabilities.magicLink || capabilities.password) && capabilities.google ? (
        <div className="auth-divider">
          <span>或</span>
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
            邮箱地址
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="输入邮箱地址"
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
            {pending ? <LoaderCircle className="spin" size={17} /> : null}
            {capabilities.password
              ? passwordMode === "sign-up"
                ? "创建账号"
                : "继续"
              : "使用邮箱继续"}
            {!pending ? <ArrowRight size={15} /> : null}
          </button>
        </form>
      ) : null}

      {capabilities.password ? (
        <p className="auth-mode-switch">
          {passwordMode === "sign-in" ? "还没有账号？" : "已经有账号？"}
          <button
            type="button"
            onClick={() =>
              setPasswordMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))
            }
          >
            {passwordMode === "sign-in" ? "创建账号" : "返回登录"}
          </button>
        </p>
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
    </div>
  );
}
