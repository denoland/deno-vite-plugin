import { defineConfig } from "vite";
import deno from "../../src/index";
import path from "node:path";

export default defineConfig({
  plugins: [deno(), {
    name: "mapped-transform",
    // @ts-ignore not sure
    transform(code, id) {
      if (id.startsWith("\0")) return;
      if (!id.includes("mapped") || path.basename(id) !== "foo.ts") return;

      return code.replace("it doesn't work", "it works");
    },
  }],
  build: {
    lib: {
      formats: ["es"],
      entry: {
        importMapAlias: "alias.ts",
        importMapAliasMapped: "alias-mapped.ts",
        importMapAliasHashPrefix: "alias-hash-prefix.ts",
        importMapNpm: "npm.ts",
        importMapJsr: "jsr.ts",
        importMapHttp: "http.ts",
        inlineExternal: "inlineExternal.ts",
        inlineNpm: "inlineNpm.ts",
        inlineJsr: "inlineJsr.ts",
        inlineHttp: "inlineHttp.ts",
        jsx: "jsx.tsx",
        resolveInRootDir: "resolveInRootDir.ts",
        linking: "linking.ts",
      },
    },
  },
});
