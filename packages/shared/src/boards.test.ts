import { describe, expect, it } from "vitest";

import {
  BOARD_NAME_MAX_LENGTH,
  boardMutationSchema,
  createBoardCommandSchema
} from "./boards.js";

describe("board commands", () => {
  it("normalizes an omitted or blank create name", () => {
    const mutationId = "d6a638a7-46a7-47ec-8f17-b7af23e20f04";

    expect(createBoardCommandSchema.parse({ mutationId, name: "   " })).toEqual({
      mutationId,
      name: undefined
    });
  });

  it("trims valid names and rejects oversized names", () => {
    expect(
      boardMutationSchema.parse({ action: "rename", name: "  Research map  " })
    ).toEqual({ action: "rename", name: "Research map" });
    expect(() =>
      boardMutationSchema.parse({
        action: "rename",
        name: "x".repeat(BOARD_NAME_MAX_LENGTH + 1)
      })
    ).toThrow();
  });

  it("rejects unknown mutation fields", () => {
    expect(() =>
      boardMutationSchema.parse({ action: "archive", workspaceId: crypto.randomUUID() })
    ).toThrow();
  });
});
