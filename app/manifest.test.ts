import { describe, it, expect } from "vitest";
import manifest from "./manifest";

// Unit tests for the web app manifest (task 17.2, Req 16.1).
// These pin down the manifest contract required for an installable PWA: a name,
// a start URL, a standalone display mode, and 192x192 and 512x512 app icons.
describe("web app manifest (Req 16.1)", () => {
  const result = manifest();

  it("specifies a non-empty application name", () => {
    expect(typeof result.name).toBe("string");
    expect((result.name ?? "").trim().length).toBeGreaterThan(0);
  });

  it('uses "/" as the start URL', () => {
    expect(result.start_url).toBe("/");
  });

  it('uses the "standalone" display mode', () => {
    expect(result.display).toBe("standalone");
  });

  it("declares 192x192 and 512x512 app icons", () => {
    const icons = result.icons ?? [];
    expect(icons.length).toBeGreaterThan(0);

    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("gives every icon a source path and PNG type", () => {
    const icons = result.icons ?? [];
    for (const icon of icons) {
      expect((icon.src ?? "").trim().length).toBeGreaterThan(0);
      expect(icon.type).toBe("image/png");
    }
  });
});
