import { z } from "zod";

const ImportUrlSchema = z
  .url()
  .refine((value) => value.startsWith("https://"), "Only HTTPS imports are accepted")
  .refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "Credentials in URLs are not accepted");

/**
 * Performs only request-shape validation. Workers must still resolve DNS and re-check
 * every destination and redirect against the SSRF policy immediately before connect.
 */
export function parseImportUrl(value: unknown): URL {
  return new URL(ImportUrlSchema.parse(value));
}
