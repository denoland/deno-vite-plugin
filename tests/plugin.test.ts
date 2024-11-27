import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { execAsync } from "../src/utils.ts";

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
    it("resolves npm:", async () => {
      await runTest(`inlineNpm.js`);
    });

    it("resolves jsr:", async () => {
      await runTest(`inlineJsr.js`);
    });

    it("resolves http:", async () => {
      await runTest(`inlineHttp.js`);
    });
  });
});
