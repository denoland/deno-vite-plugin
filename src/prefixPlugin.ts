import type { Loader } from "@deno/loader";
import type { Plugin } from "vite";
import {
  DENO_HTTP_PREFIX,
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
  getCache: (envName?: string) => Map<string, DenoResolveResult>,
  getLoader: (envName?: string) => Promise<Loader>,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno:prefix",
    enforce: "pre",
    // @ts-ignore Vite 7+ Environment API
    sharedDuringBuild: true,
    // @ts-ignore Vite 7+ Environment API
    applyToEnvironment() {
      return true;
    },
    configResolved(config) {
      // Root path given by Vite always uses posix separators.
      root = path.normalize(config.root);
    },
    async resolveId(id, importer) {
      // @ts-ignore Vite 7+ Environment API
      const envName: string | undefined = this.environment?.name;

      // Strip deno-http:: prefix added by the load hook to prevent
      // Vite's SSR module runner from treating https:// as external.
      if (id.startsWith(DENO_HTTP_PREFIX)) {
        id = id.slice(DENO_HTTP_PREFIX.length);
      }

      if (id.startsWith("npm:")) {
        const loader = await getLoader(envName);
        const resolved = await resolveDeno(id, loader);
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
        const loader = await getLoader(envName);
        const cache = getCache(envName);
        return await resolveViteSpecifier(id, cache, root, loader, importer);
      }
    },
  };
}
