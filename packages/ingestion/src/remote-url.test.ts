import { describe, expect, it } from "vitest";

import { parseImportUrl } from "./remote-url.js";

describe("parseImportUrl", () => {
  it("accepts an HTTPS URL without credentials", () => {
    expect(parseImportUrl("https://example.com/article").hostname).toBe("example.com");
  });

  it.each(["http://example.com", "file:///etc/passwd", "https://user:pass@example.com"])(
    "rejects unsafe request shape %s",
    (value) => {
      expect(() => parseImportUrl(value)).toThrow();
    }
  );
});
