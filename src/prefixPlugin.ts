import type { Loader } from "@deno/loader";
import type { Plugin } from "vite";
import {
  type DenoResolveResult,
  resolveDeno,
  resolveViteSpecifier,
} from "./resolver.js";
import process from "node:process";
import path from "node:path";

export default function denoPrefixPlugin(
  cache: Map<string, DenoResolveResult>,
  getLoader: (root: string) => Promise<Loader>,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno:prefix",
    enforce: "pre",
    configResolved(config) {
      // Root path given by Vite always uses posix separators.
      root = path.normalize(config.root);
    },
    async resolveId(id, importer) {
      if (id.startsWith("npm:")) {
        const loader = await getLoader(root);
        const resolved = await resolveDeno(id, loader);
        if (resolved === null) return;

        // TODO: Resolving custom versions is not supported at the moment
        const result = await this.resolve(resolved.id);
        return result ?? resolved.id;
      } else if (id.startsWith("http:") || id.startsWith("https:")) {
        const loader = await getLoader(root);
        return await resolveViteSpecifier(id, cache, root, loader, importer);
      }
    },
  };
}
