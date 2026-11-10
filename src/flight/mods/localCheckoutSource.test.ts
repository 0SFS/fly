import { describe, expect, it } from "vitest";
import { localCheckoutSource } from "./localCheckoutSource";

const pagesMiss = new Error("Failed to load mod manifest https://0sfs.github.io/Starship/0sfs-mod.json (404).");

describe("localCheckoutSource", () => {
  it("points an unpublished owner/repo at the checkout", () => {
    expect(localCheckoutSource("0SFS/Starship", pagesMiss)).toBe("local:0SFS/Starship");
    expect(localCheckoutSource(" https://0sfs.github.io/Starship/ ", pagesMiss)).toBe("local:0sfs/Starship");
  });

  it("leaves a local source, a pinned ref, and any other failure alone", () => {
    expect(localCheckoutSource("local:0SFS/Starship", pagesMiss)).toBeNull();
    expect(localCheckoutSource("0SFS/Starship@v1", new Error("Failed to load mod manifest https://raw.githubusercontent.com/0SFS/Starship/v1/public/0sfs-mod.json (404)."))).toBeNull();
    expect(localCheckoutSource("0SFS/Starship", new Error("Failed to load mod manifest https://0sfs.github.io/Starship/0sfs-mod.json (500)."))).toBeNull();
    expect(localCheckoutSource("not a source", pagesMiss)).toBeNull();
  });
});