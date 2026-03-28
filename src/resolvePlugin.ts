import { type Loader, RequestedModuleType } from "@deno/loader";
import type { Plugin } from "vite";
import {
  DENO_HTTP_PREFIX,
  type DenoResolveResult,
  isDenoSpecifier,
  parseDenoSpecifier,
  resolveViteSpecifier,
} from "./resolver.js";
import type { LoadContext, OnLoadResult } from "./index.js";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const textDecoder = new TextDecoder();

// Rewrite http(s):// import specifiers so Vite's SSR module runner
// doesn't short-circuit them as external URLs. Matches:
//   from "https://..."  /  from 'https://...'
//   import("https://...")  /  import('https://...')
const HTTP_IMPORT_RE = /(from\s+|import\s*\()(['"])(https?:\/\/[^'"]+)\2/g;

function rewriteHttpImports(code: string): string {
  return code.replace(
    HTTP_IMPORT_RE,
    (_, prefix, quote, url) =>
      `${prefix}${quote}${DENO_HTTP_PREFIX}${url}${quote}`,
  );
}

export default function denoPlugin(
  cache: Map<string, DenoResolveResult>,
  getLoader: (envName?: string) => Promise<Loader>,
  onLoad?: (ctx: LoadContext) => OnLoadResult,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno",
    sharedDuringBuild: true,
    applyToEnvironment() {
      return true;
    },
    configResolved(config) {
      // Root path given by Vite always uses posix separators.
      root = path.normalize(config.root);
    },
    async resolveId(id, importer) {
      // The "pre"-resolve plugin already resolved it
      if (isDenoSpecifier(id)) return;

      const envName = this.environment?.name;
      const loader = await getLoader(envName);
      return await resolveViteSpecifier(id, cache, root, loader, importer);
    },
    async load(id) {
      if (!isDenoSpecifier(id)) return;

      const { loader: mediaType, resolved } = parseDenoSpecifier(
        id,
      );

      const envName = this.environment?.name;
      const denoLoader = await getLoader(envName);
      const specifierUrl = resolved.startsWith("/") ||
          /^[a-zA-Z]:/.test(resolved)
        ? pathToFileURL(resolved).href
        : resolved;
      const loadResult = await denoLoader.load(
        specifierUrl,
        RequestedModuleType.Default,
      );
      if (loadResult.kind === "external") return;

      // TODO: @deno/loader's load() doesn't return source maps, so
      // dev-mode debugging for remote TypeScript modules is degraded.
      const code = textDecoder.decode(loadResult.code);

      // Rewrite https:// imports so Vite's SSR module runner doesn't
      // treat them as external URLs (ERR_UNSUPPORTED_ESM_URL_SCHEME).
      const rewritten = rewriteHttpImports(code);

      if (onLoad) {
        const consumer = this.environment?.config?.consumer;
        const result = onLoad({
          code: rewritten,
          id: specifierUrl,
          mediaType: loadResult.mediaType,
          environment: envName ?? "default",
          ssr: consumer === "server",
        });
        if (result) return result;
      }

      if (mediaType === "Json") {
        return `export default ${rewritten}`;
      }

      return rewritten;
    },
  };
}
