import { createHash } from "node:crypto";

import { PDFParse } from "pdf-parse";

import { PHASE_1_LIMITS, type AssetSourceType } from "@siftloom/shared";

import { IngestionError } from "./errors.js";
import type { ObjectStorage } from "./object-storage.js";
import { fetchSafeRemote } from "./safe-remote.js";

export interface ExtractionSegmentInput {
  readonly text: string;
  readonly location: Record<string, unknown>;
  readonly contentHash: string;
}

export interface ExtractedSource {
  readonly title: string | null;
  readonly sourceMime: string;
  readonly contentHash: string;
  readonly extractorVersion: string;
  readonly warnings: readonly string[];
  readonly provenance: Record<string, unknown>;
  readonly segments: readonly ExtractionSegmentInput[];
}

export interface ExtractableAsset {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceType: AssetSourceType;
  readonly objectKey: string | null;
  readonly originalFileName: string | null;
  readonly sourceUrl: string | null;
  readonly declaredMime: string | null;
  readonly contentHash: string | null;
}

function hash(bytesOrText: Uint8Array | string): string {
  return createHash("sha256").update(bytesOrText).digest("hex");
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitText(
  text: string,
  locationFactory: (start: number, end: number, ordinal: number) => Record<string, unknown>
): ExtractionSegmentInput[] {
  const normalized = normalizeText(text).slice(0, PHASE_1_LIMITS.text.maxCharacters);
  if (!normalized) return [];
  const segments: ExtractionSegmentInput[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + 4_000);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf(". ", end)
      );
      if (boundary > start + 1_000) end = boundary + 1;
    }
    const segmentText = normalized.slice(start, end).trim();
    if (segmentText) {
      segments.push({
        text: segmentText,
        location: locationFactory(start, end, segments.length),
        contentHash: hash(segmentText)
      });
    }
    start = end;
  }
  return segments;
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, token: string) => {
    if (token.startsWith("#")) {
      const hex = token[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(parsed) && parsed > 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : " ";
    }
    return entities[token.toLowerCase()] ?? " ";
  });
}

function htmlToText(html: string): {
  readonly title: string | null;
  readonly text: string;
} {
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const withoutActiveContent = html
    .replace(/<(script|style|noscript|svg|template)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  const text = decodeHtmlEntities(
    withoutActiveContent
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)(?:\s[^>]*)?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  return {
    title: titleMatch ? normalizeText(decodeHtmlEntities(titleMatch)).slice(0, 500) : null,
    text: normalizeText(text)
  };
}

async function extractUpload(
  asset: ExtractableAsset,
  storage: ObjectStorage
): Promise<ExtractedSource> {
  if (!asset.objectKey || !asset.declaredMime) {
    throw new IngestionError("invalid_upload", "上传记录不完整，请重新上传。", false);
  }
  const bytes = await storage.get(asset.workspaceId, asset.objectKey);
  const contentHash = hash(bytes);
  if (asset.contentHash && asset.contentHash !== contentHash) {
    throw new IngestionError("checksum_mismatch", "上传文件校验失败，请重新上传。", false);
  }
  if (asset.declaredMime === "text/plain") {
    if (bytes.byteLength > PHASE_1_LIMITS.text.maxTxtBytes || bytes.includes(0)) {
      throw new IngestionError("invalid_text_file", "纯文本文件格式无效。", false);
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new IngestionError(
        "invalid_text_file",
        "纯文本文件必须使用 UTF-8 编码。",
        false
      );
    }
    const segments = splitText(text, (start, end) => ({ start, end }));
    if (segments.length === 0) {
      throw new IngestionError("empty_source", "文件中没有可提取的文字。", false);
    }
    return {
      title: asset.originalFileName,
      sourceMime: "text/plain",
      contentHash,
      extractorVersion: "siftloom-text-1",
      warnings: [],
      provenance: {
        originalFileName: asset.originalFileName,
        retrievedAt: new Date().toISOString(),
        sourceMime: "text/plain",
        extractorVersion: "siftloom-text-1",
        contentHash
      },
      segments
    };
  }
  if (
    bytes.byteLength > PHASE_1_LIMITS.pdf.maxBytes ||
    !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))
  ) {
    throw new IngestionError("invalid_pdf", "PDF 文件签名或大小无效。", false);
  }
  const parser = new PDFParse({ data: bytes });
  try {
    const info = await parser.getInfo();
    if (info.total > PHASE_1_LIMITS.pdf.maxPages) {
      throw new IngestionError("pdf_page_limit", "PDF 页数超过 200 页限制。", false);
    }
    const result = await parser.getText({ first: 1, last: info.total, pageJoiner: "" });
    const segments = result.pages.flatMap((page) =>
      splitText(page.text, (start, end) => ({ page: page.num, start, end }))
    );
    if (segments.length === 0) {
      throw new IngestionError(
        "pdf_text_unavailable",
        "该 PDF 没有可提取文字；M3 暂不提供 OCR。",
        false
      );
    }
    const title =
      typeof info.info?.Title === "string" && info.info.Title.trim()
        ? info.info.Title.trim().slice(0, 500)
        : asset.originalFileName;
    return {
      title,
      sourceMime: "application/pdf",
      contentHash,
      extractorVersion: "pdf-parse-2.3.6",
      warnings: [],
      provenance: {
        originalFileName: asset.originalFileName,
        pages: info.total,
        retrievedAt: new Date().toISOString(),
        sourceMime: "application/pdf",
        extractorVersion: "pdf-parse-2.3.6",
        contentHash
      },
      segments
    };
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError(
      "pdf_parse_failed",
      "PDF 无法解析，可能已加密或格式损坏。",
      false
    );
  } finally {
    await parser.destroy();
  }
}

function parseYouTubeId(url: URL): string | null {
  if (url.hostname === "youtu.be")
    return /^[A-Za-z0-9_-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
  if (
    url.hostname === "www.youtube.com" ||
    url.hostname === "youtube.com" ||
    url.hostname === "m.youtube.com"
  ) {
    const id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/)?.[1];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  return null;
}

function parseIsoDurationSeconds(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

async function extractYouTube(
  asset: ExtractableAsset,
  youtubeApiKey: string | undefined
): Promise<ExtractedSource> {
  if (!asset.sourceUrl)
    throw new IngestionError("invalid_video_url", "视频网址无效。", false);
  const sourceUrl = new URL(asset.sourceUrl);
  const videoId = parseYouTubeId(sourceUrl);
  if (!videoId) {
    throw new IngestionError(
      "unsupported_video_url",
      "目前仅支持公开 YouTube 视频网址。",
      false
    );
  }
  if (!youtubeApiKey) {
    throw new IngestionError(
      "video_provider_unconfigured",
      "公开视频元数据服务尚未配置；你仍可上传有权处理的文字稿。",
      false
    );
  }
  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  apiUrl.searchParams.set("part", "snippet,contentDetails,status");
  apiUrl.searchParams.set("id", videoId);
  apiUrl.searchParams.set("key", youtubeApiKey);
  const response = await fetchSafeRemote(apiUrl, { maxBytes: 1_000_000 });
  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as {
    items?: Array<{
      snippet?: { title?: string; description?: string; channelTitle?: string };
      contentDetails?: { duration?: string };
      status?: { privacyStatus?: string; embeddable?: boolean };
    }>;
  };
  const item = parsed.items?.[0];
  if (!item || item.status?.privacyStatus !== "public") {
    throw new IngestionError("video_unavailable", "该视频不是可访问的公开来源。", false);
  }
  const durationSeconds = parseIsoDurationSeconds(item.contentDetails?.duration ?? "");
  if (durationSeconds > PHASE_1_LIMITS.publicVideo.maxDurationSeconds) {
    throw new IngestionError("video_duration_limit", "视频时长超过 120 分钟限制。", false);
  }
  const text = [
    item.snippet?.title,
    item.snippet?.channelTitle ? `Channel: ${item.snippet.channelTitle}` : null,
    item.snippet?.description
  ]
    .filter(Boolean)
    .join("\n\n");
  const segments = splitText(text, (start, end) => ({ start, end }));
  return {
    title: item.snippet?.title?.slice(0, 500) ?? null,
    sourceMime: "application/vnd.youtube.metadata+json",
    contentHash: hash(text),
    extractorVersion: "youtube-data-api-v3-metadata-1",
    warnings: ["transcript_unavailable"],
    provenance: {
      sourceUrl: asset.sourceUrl,
      videoId,
      durationSeconds,
      retrievedAt: new Date().toISOString(),
      sourceMime: "application/vnd.youtube.metadata+json",
      extractorVersion: "youtube-data-api-v3-metadata-1",
      contentHash: hash(text)
    },
    segments
  };
}

async function extractWebpage(asset: ExtractableAsset): Promise<ExtractedSource> {
  if (!asset.sourceUrl)
    throw new IngestionError("invalid_webpage_url", "网页网址无效。", false);
  const response = await fetchSafeRemote(asset.sourceUrl);
  if (
    !response.contentType.startsWith("text/html") &&
    !response.contentType.startsWith("text/plain")
  ) {
    throw new IngestionError(
      "unsupported_remote_type",
      "该网址不是受支持的网页或纯文本。",
      false
    );
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(response.body);
  const extracted = response.contentType.startsWith("text/html")
    ? htmlToText(decoded)
    : { title: null, text: normalizeText(decoded) };
  const segments = splitText(extracted.text, (start, end) => ({ start, end }));
  if (segments.length === 0) {
    throw new IngestionError("empty_source", "网页中没有可提取的文字。", false);
  }
  return {
    title: extracted.title,
    sourceMime: response.contentType,
    contentHash: hash(response.body),
    extractorVersion: "siftloom-web-text-1",
    warnings: [],
    provenance: {
      sourceUrl: asset.sourceUrl,
      retrievedUrl: response.url.toString(),
      retrievedAt: new Date().toISOString(),
      sourceMime: response.contentType,
      extractorVersion: "siftloom-web-text-1",
      contentHash: hash(response.body)
    },
    segments
  };
}

export async function extractSource(
  asset: ExtractableAsset,
  dependencies: {
    readonly storage: ObjectStorage;
    readonly youtubeApiKey?: string;
  }
): Promise<ExtractedSource> {
  if (asset.sourceType === "upload") return extractUpload(asset, dependencies.storage);
  if (asset.sourceType === "youtube")
    return extractYouTube(asset, dependencies.youtubeApiKey);
  return extractWebpage(asset);
}
