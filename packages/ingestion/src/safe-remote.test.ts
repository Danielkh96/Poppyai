import { describe, expect, it } from "vitest";

import { resolvePublicAddresses } from "./safe-remote.js";

describe("resolvePublicAddresses", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.7",
    "169.254.169.254",
    "192.168.1.5",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1"
  ])("rejects private, loopback, link-local, and mapped address %s", async (address) => {
    await expect(resolvePublicAddresses(address)).rejects.toMatchObject({
      code: "unsafe_remote_destination",
      retryable: false
    });
  });

  it("accepts a public literal without performing DNS", async () => {
    await expect(resolvePublicAddresses("8.8.8.8")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 }
    ]);
  });
});
