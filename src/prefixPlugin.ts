import { Plugin } from "vite";
import { resolveDeno } from "./resolver.js";
import process from "node:process";

export default function denoPrefixPlugin(): Plugin {
  let root = process.cwd();

  return {
    name: "deno-prefix",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async resolveId(id) {
      if (id.startsWith("npm:")) {
        const resolved = await resolveDeno(id, root);
        if (resolved === null) return;

        // TODO: Resolving custom versions is not supported at the moment
        const actual = resolved.id.slice(0, resolved.id.indexOf("@"));
        return this.resolve(actual);
      }
    },
  };
}
