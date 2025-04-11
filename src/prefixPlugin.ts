import { Plugin } from "vite";
import {
  DenoResolveResult,
  resolveDeno,
  resolveViteSpecifier,
} from "./resolver.js";
import process from "node:process";

export default function denoPrefixPlugin(
  cache: Map<string, DenoResolveResult>,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno:prefix",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async resolveId(id, importer) {
      if (id.startsWith("npm:")) {
        const resolved = await resolveDeno(id, root);
        if (resolved === null) return;

        const match = resolved.id.match(/^(@?[^@/]+)(?:@?([^@/]+))?(\/.+)?$/);
        if (!match) return;

        const [, pkg, _version, path = ""] = match;

        // TODO: Resolving custom versions is not supported at the moment
        const actual = pkg + path;
        const result = await this.resolve(actual);
        return result ?? actual;
      } else if (id.startsWith("http:") || id.startsWith("https:")) {
        return await resolveViteSpecifier(id, cache, root, importer);
      }
    },
  };
}
