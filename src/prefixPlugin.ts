import type { Plugin } from "vite";
import {
  type DenoResolveResult,
  resolveDeno,
  resolveViteSpecifier,
} from "./resolver.js";
import process from "node:process";
import path from "node:path";

/**
 * Extract the bare package name from an npmPackage identifier returned
 * by `deno info --json`. The format is:
 *   - Unscoped: `preact@10.25.4`
 *   - Scoped:   `@preact/signals@2.8.1_preact@10.25.4`
 *
 * For scoped packages the first `@` is part of the scope, so the
 * version separator is the `@` immediately after the package name
 * (i.e., the first `@` after the `/`).
 */
export function extractPackageName(npmPackage: string): string {
  const versionSep = npmPackage.startsWith("@")
    ? npmPackage.indexOf("@", npmPackage.indexOf("/"))
    : npmPackage.indexOf("@");

  return versionSep === -1 ? npmPackage : npmPackage.slice(0, versionSep);
}

export default function denoPrefixPlugin(
  cache: Map<string, DenoResolveResult>,
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
        const resolved = await resolveDeno(id, root);
        if (resolved === null) return;

        const packageName = extractPackageName(resolved.id);
        const result = await this.resolve(packageName);

        if (result) return result;

        // The package could not be found in node_modules. This typically
        // happens when the npm specifier comes from a JSR package whose
        // transitive npm dependencies are not installed locally.
        this.warn(
          `Could not resolve npm package "${packageName}" (from "${id}"). ` +
            `The package may need to be added to your project's package.json ` +
            `or import map so that it is installed in node_modules.`,
        );
        return;
      } else if (id.startsWith("http:") || id.startsWith("https:")) {
        return await resolveViteSpecifier(id, cache, root, importer);
      }
    },
  };
}
