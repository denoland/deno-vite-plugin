import { defineConfig } from "vite";
import deno from "../../src/index";

export default defineConfig({
  plugins: [deno()],
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
        inlineNpm: "inlineNpm.ts",
        inlineJsr: "inlineJsr.ts",
        inlineHttp: "inlineHttp.ts",
      },
    },
  },
});
