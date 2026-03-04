import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { execAsync } from "../src/utils.ts";
import { extractPackageName } from "../src/prefixPlugin.ts";

const fixtureDir = path.join(import.meta.dirname!, "fixture");

async function runTest(file: string) {
  const res = await execAsync(`node dist/${file}`, {
    cwd: fixtureDir,
  });
  expect(res.stdout.trim()).toEqual("it works");
}

describe("Deno plugin", () => {
  beforeAll(async () => {
    await execAsync(`npx vite build`, {
      cwd: fixtureDir,
    });
  });

  describe("import map", () => {
    it("resolves alias", async () => {
      await runTest(`importMapAlias.js`);
    });

    it("resolves alias mapped", async () => {
      await runTest(`importMapAliasMapped.js`);
    });

    it("resolves alias mapped with hash prefix", async () => {
      await runTest(`importMapAliasHashPrefix.js`);
    });

    it("resolves npm:", async () => {
      await runTest(`importMapNpm.js`);
    });

    it("resolves jsr:", async () => {
      await runTest(`importMapJsr.js`);
    });

    it("resolves http:", async () => {
      await runTest(`importMapHttp.js`);
    });
  });

  describe("inline", () => {
    it("resolves external:", async () => {
      await runTest(`inlineExternal.js`);
    });

    it("resolves npm:", async () => {
      await runTest(`inlineNpm.js`);
    });

    it("resolves scoped npm:", async () => {
      await runTest(`inlineScopedNpm.js`);
    });

    it("resolves jsr:", async () => {
      await runTest(`inlineJsr.js`);
    });

    it("resolves http:", async () => {
      await runTest(`inlineHttp.js`);
    });
  });

  // https://github.com/denoland/deno-vite-plugin/issues/42
  it("resolve to file in root dir", async () => {
    await runTest(`resolveInRootDir.js`);
  });
});

describe("extractPackageName", () => {
  it("handles unscoped packages", () => {
    expect(extractPackageName("preact@10.25.4")).toEqual("preact");
  });

  it("handles scoped packages", () => {
    expect(extractPackageName("@preact/signals@2.8.1")).toEqual(
      "@preact/signals",
    );
  });

  it("handles scoped packages with peer dep suffixes", () => {
    expect(
      extractPackageName("@preact/signals@2.8.1_preact@10.25.4"),
    ).toEqual("@preact/signals");
  });

  it("handles packages without version", () => {
    expect(extractPackageName("preact")).toEqual("preact");
  });

  it("handles scoped packages without version", () => {
    expect(extractPackageName("@preact/signals")).toEqual("@preact/signals");
  });
});
