import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request } from "node:https";

import { PHASE_1_LIMITS } from "@siftloom/shared";

import { IngestionError } from "./errors.js";
import { parseImportUrl } from "./remote-url.js";

const blockedAddresses = new BlockList();
for (const [address, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"]
] as const) {
  blockedAddresses.addSubnet(address, prefix, family);
}

function isForbiddenAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isForbiddenAddress(mapped);
  const family = isIP(address);
  if (family === 0) return true;
  return blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

export async function resolvePublicAddresses(hostname: string): Promise<LookupAddress[]> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await new Promise<LookupAddress[]>((resolve, reject) => {
        dnsLookup(hostname, { all: true, verbatim: true }, (error, values) => {
          if (error) reject(error);
          else resolve(values);
        });
      });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isForbiddenAddress(address))
  ) {
    throw new IngestionError(
      "unsafe_remote_destination",
      "该网址指向不允许访问的网络位置。",
      false
    );
  }
  return addresses;
}

function createSafeLookup(): LookupFunction {
  return ((hostname, options, callback) => {
    void resolvePublicAddresses(hostname)
      .then((addresses) => {
        const wantsAll = typeof options === "object" && options.all === true;
        if (wantsAll) {
          callback(null, addresses);
          return;
        }
        const first = addresses[0];
        if (!first) {
          callback(new Error("No public destination"), "", 4);
          return;
        }
        callback(null, first.address, first.family);
      })
      .catch((error: unknown) => callback(error as Error, "", 4));
  }) as LookupFunction;
}

export interface SafeRemoteResponse {
  readonly url: URL;
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

export async function fetchSafeRemote(
  input: URL | string,
  options: {
    readonly maxBytes?: number;
    readonly timeoutMs?: number;
    readonly maxRedirects?: number;
  } = {}
): Promise<SafeRemoteResponse> {
  let current = parseImportUrl(input.toString());
  const maxBytes = options.maxBytes ?? PHASE_1_LIMITS.webpage.maxDecodedBytes;
  const timeoutMs = options.timeoutMs ?? PHASE_1_LIMITS.webpage.timeoutMs;
  const maxRedirects = options.maxRedirects ?? PHASE_1_LIMITS.webpage.maxRedirects;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (current.port !== "" && current.port !== "443") {
      throw new IngestionError(
        "unsupported_remote_port",
        "仅支持使用标准 HTTPS 端口的公开网址。",
        false
      );
    }
    await resolvePublicAddresses(current.hostname);
    const response = await new Promise<SafeRemoteResponse & { readonly location?: string }>(
      (resolve, reject) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const remoteRequest = request(
          current,
          {
            method: "GET",
            headers: {
              Accept: "text/html,text/plain,application/json;q=0.8",
              "Accept-Encoding": "identity",
              "User-Agent": "Siftloom-Ingestion/1.0"
            },
            lookup: createSafeLookup(),
            signal: controller.signal
          },
          (remoteResponse) => {
            const status = remoteResponse.statusCode ?? 0;
            const location = remoteResponse.headers.location;
            const declaredLength = Number(remoteResponse.headers["content-length"] ?? 0);
            if (declaredLength > maxBytes) {
              remoteResponse.destroy();
              clearTimeout(timeout);
              reject(
                new IngestionError(
                  "remote_source_too_large",
                  "网页内容超过允许的大小。",
                  false
                )
              );
              return;
            }
            const chunks: Buffer[] = [];
            let received = 0;
            remoteResponse.on("data", (chunk: Buffer) => {
              received += chunk.length;
              if (received > maxBytes) {
                remoteResponse.destroy(
                  new IngestionError(
                    "remote_source_too_large",
                    "网页内容超过允许的大小。",
                    false
                  )
                );
                return;
              }
              chunks.push(chunk);
            });
            remoteResponse.on("error", reject);
            remoteResponse.on("end", () => {
              clearTimeout(timeout);
              resolve({
                url: current,
                status,
                contentType:
                  String(remoteResponse.headers["content-type"] ?? "")
                    .split(";")[0]
                    ?.trim()
                    .toLowerCase() ?? "",
                body: Buffer.concat(chunks),
                ...(location ? { location } : {})
              });
            });
          }
        );
        remoteRequest.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        remoteRequest.end();
      }
    );

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirect === maxRedirects) {
        throw new IngestionError("remote_redirect_limit", "网址重定向次数过多。", false);
      }
      current = parseImportUrl(new URL(response.location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IngestionError(
        response.status >= 500
          ? "remote_provider_unavailable"
          : "remote_source_unavailable",
        "无法读取该公开来源，请确认网址可以直接访问。",
        response.status >= 500
      );
    }
    return response;
  }
  throw new IngestionError("remote_redirect_limit", "网址重定向次数过多。", false);
}
