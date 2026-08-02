import type { NextConfig } from "next";

const developmentSources = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

function storageConnectSource(): string {
  const configuredEndpoint = process.env.S3_ENDPOINT;
  if (configuredEndpoint) {
    try {
      return ` ${new URL(configuredEndpoint).origin}`;
    } catch {
      return "";
    }
  }
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  return bucket && region ? ` https://${bucket}.s3.${region}.amazonaws.com` : "";
}

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${developmentSources}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ws: wss:${storageConnectSource()}`,
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@siftloom/shared", "@siftloom/ui"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
