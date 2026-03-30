import * as path from "node:path";
import child_process from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

function execAsync(
  cmd: string,
  options: child_process.ExecOptions,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) =>
    child_process.exec(cmd, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    })
  );
}

const fixtureDir = path.join(import.meta.dirname!, "fixture");

async function runTest(file: string) {
  const res = await execAsync(`node dist/${file}`, {
    cwd: fixtureDir,
  });
  expect(res.stdout.trim()).toEqual("it works");
}

describe("Deno plugin", () => {
  beforeAll(async () => {
    await execAsync(
      `deno run -A --unstable-bare-node-builtins npm:vite build`,
      {
        cwd: fixtureDir,
      },
    );
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

    it("resolves jsr:", async () => {
      await runTest(`inlineJsr.js`);
    });

    it("resolves http:", async () => {
      await runTest(`inlineHttp.js`);
    });

    it("resolves json module", async () => {
      await runTest(`inlineHttpJson.js`);
    });
  });

  // https://github.com/denoland/deno-vite-plugin/issues/42
  it("resolve to file in root dir", async () => {
    await runTest(`resolveInRootDir.js`);
  });
});
