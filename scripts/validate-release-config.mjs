const profileArgument = process.argv.find((value) => value.startsWith("--profile="));
const profile = profileArgument?.split("=")[1] ?? "production";

if (!new Set(["local", "production"]).has(profile)) {
  throw new Error("Profile must be local or production");
}

const failures = [];
const required = [
  "MIGRATION_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "DATABASE_URL",
  "WORKER_DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "AI_PROVIDER"
];

for (const name of required) {
  if (!process.env[name]?.trim()) failures.push(`${name} is required`);
}

function parseUrl(name) {
  const value = process.env[name];
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    failures.push(`${name} must be a valid URL`);
    return null;
  }
}

const databaseNames = [
  "MIGRATION_DATABASE_URL",
  "AUTH_DATABASE_URL",
  "DATABASE_URL",
  "WORKER_DATABASE_URL"
];
const databaseUrls = databaseNames.map((name) => ({ name, url: parseUrl(name) }));
const usernames = databaseUrls
  .map(({ url }) => url?.username)
  .filter((value) => Boolean(value));
if (new Set(usernames).size !== usernames.length) {
  failures.push("Database URLs must use distinct migration, auth, web, and worker roles");
}

const authSecret = process.env.BETTER_AUTH_SECRET ?? "";
if (
  authSecret.length < 32 ||
  (profile === "production" && /replace|example|changeme/i.test(authSecret))
) {
  failures.push("BETTER_AUTH_SECRET must be at least 32 non-placeholder characters");
}

const googleClientIdConfigured = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
const googleClientSecretConfigured = Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
if (googleClientIdConfigured !== googleClientSecretConfigured) {
  failures.push("Google OAuth requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
}

if (profile === "production") {
  if (process.env.DEPLOYMENT_ENV !== "production") {
    failures.push("DEPLOYMENT_ENV must be production");
  }
  const authUrl = parseUrl("BETTER_AUTH_URL");
  if (authUrl?.protocol !== "https:") failures.push("BETTER_AUTH_URL must use HTTPS");
  if (process.env.AUTH_ENABLE_PASSWORD === "true") {
    failures.push("AUTH_ENABLE_PASSWORD must not be enabled in production");
  }
  const googleConfigured = googleClientIdConfigured && googleClientSecretConfigured;
  const emailConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM
  );
  if (!googleConfigured && !emailConfigured) {
    failures.push("Production requires Google OIDC or Resend magic-link configuration");
  }
  if (process.env.AI_PROVIDER !== "openai") {
    failures.push("Production private alpha requires the approved openai provider");
  }
  if (!(process.env.OPENAI_API_KEY ?? "").startsWith("sk-")) {
    failures.push("OPENAI_API_KEY is required for the approved production provider");
  }
  if (!process.env.OPENAI_MODEL?.trim()) failures.push("OPENAI_MODEL is required");

  const endpoint = process.env.S3_ENDPOINT ? parseUrl("S3_ENDPOINT") : null;
  if (endpoint && ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)) {
    failures.push("Production S3 endpoint cannot be local");
  }
  if (endpoint && endpoint.protocol !== "https:") {
    failures.push("Production S3 endpoint must use HTTPS");
  }
  for (const { name, url } of databaseUrls) {
    if (!url) continue;
    const sslMode = url.searchParams.get("sslmode");
    if (!new Set(["require", "verify-ca", "verify-full"]).has(sslMode)) {
      failures.push(`${name} must explicitly require TLS`);
    }
  }
  for (const name of ["SUPPORT_EMAIL", "PRIVACY_CONTACT_EMAIL"]) {
    const value = process.env[name] ?? "";
    if (
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ||
      /\.(invalid|local)$|@example\./i.test(value)
    ) {
      failures.push(`${name} must be a deliverable production address`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Release configuration failed (${profile}):\n${failures.map((item) => `- ${item}`).join("\n")}\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release configuration passed (${profile}); no secret values printed.\n`
  );
}
