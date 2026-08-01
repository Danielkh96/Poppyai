import "server-only";

import { authAccounts, authSessions, authUsers, authVerifications } from "@siftloom/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

import { getAuthDatabaseClient } from "@/lib/server/database";

const passwordEnabled =
  process.env.NODE_ENV !== "production" && process.env.AUTH_ENABLE_PASSWORD === "true";
const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);
const magicLinkEnabled = Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);

async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Magic-link email delivery is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "登录 Siftloom",
      text: `请在 10 分钟内使用此链接登录 Siftloom：${url}`
    }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) throw new Error(`Magic-link delivery failed (${response.status})`);
}

export const authCapabilities = {
  google: googleEnabled,
  magicLink: magicLinkEnabled,
  password: passwordEnabled
} as const;

export const auth = betterAuth({
  appName: "Siftloom",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getAuthDatabaseClient().db, {
    provider: "pg",
    schema: {
      user: authUsers,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications
    }
  }),
  emailAndPassword: {
    enabled: passwordEnabled,
    minPasswordLength: 12
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!
        }
      }
    : undefined,
  plugins: [
    magicLink({
      expiresIn: 600,
      storeToken: "hashed",
      rateLimit: { window: 60, max: 5 },
      sendMagicLink: ({ email, url }) => sendMagicLinkEmail(email, url)
    })
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24
  },
  advanced: {
    cookiePrefix: "siftloom",
    useSecureCookies: process.env.NODE_ENV === "production"
  }
});
