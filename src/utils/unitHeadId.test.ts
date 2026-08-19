import { describe, it, expect } from "vitest";
import { unitHeadIdFor } from "./unitHeadId";

describe("unitHeadIdFor", () => {
  it("prefixes the unit id with 'head-'", () => {
    expect(unitHeadIdFor("u1")).toBe("head-u1");
  });

  it("is stable for the same input", () => {
    expect(unitHeadIdFor("u4")).toBe(unitHeadIdFor("u4"));
  });
});
