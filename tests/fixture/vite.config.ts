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
        importMapNpm: "npm.ts",
        importMapJsr: "jsr.ts",
        importMapHttp: "http.ts",
        inlineExternal: 'inlineExternal.ts',
        inlineNpm: "inlineNpm.ts",
        inlineJsr: "inlineJsr.ts",
        inlineHttp: "inlineHttp.ts",
      },
    },
  },
});
