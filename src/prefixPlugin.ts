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

        // TODO: Resolving custom versions is not supported at the moment
        const actual = resolved.id.slice(0, resolved.id.indexOf("@"));
        const result = await this.resolve(actual);
        return result ?? actual;
      } else if (id.startsWith("http:") || id.startsWith("https:")) {
        return await resolveViteSpecifier(id, cache, root, importer);
      }
    },
    transform(code, id) {
      if (!id.endsWith(".jsx") && !id.endsWith(".tsx")) return;

      const match = code.match(
        /\/\*\*\s*@jsxImportSource\s+npm:(@?[^@\s*]+)([^\s*]*)\s*\*\//,
      );

      if (match) {
        return code.replace(match[0], `/** @jsxImportSource ${match[1]} */`);
      }
    },
  };
}
