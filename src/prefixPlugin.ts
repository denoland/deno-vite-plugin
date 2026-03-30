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

        // TODO: Resolving custom versions is not supported at the moment
        const result = await this.resolve(resolved.id);
        return result ?? resolved.id;
      } else if (id.startsWith("http:") || id.startsWith("https:")) {
        const loader = await getLoader(envName);
        const cache = getCache(envName);
        return await resolveViteSpecifier(id, cache, root, loader, importer);
      }
    },
  };
}
