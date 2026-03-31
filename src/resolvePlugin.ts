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
// doesn't short-circuit them as external URLs. Matches static imports,
// re-exports, and dynamic imports:
//   import x from "https://..."
//   export { x } from "https://..."
//   import("https://...")
// Known limitations: does not match template literal dynamic imports,
// and may match URLs inside comments or strings. A proper AST transform
// would be needed for full correctness.
const HTTP_IMPORT_RE =
  /(?:from\s+|export\s+.*?from\s+|import\s*\()(['"])(https?:\/\/[^'"]+)\1/g;

function rewriteHttpImports(code: string): string {
  return code.replace(
    HTTP_IMPORT_RE,
    (match, _quote, url) => match.replace(url, `${DENO_HTTP_PREFIX}${url}`),
  );
}

export default function denoPlugin(
  getCache: (envName?: string) => Map<string, DenoResolveResult>,
  getLoader: (envName?: string) => Promise<Loader>,
  onLoad?: (ctx: LoadContext) => OnLoadResult | Promise<OnLoadResult>,
  isExcluded?: ((id: string) => boolean) | null,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno",
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
    // @ts-ignore Vite 7+ configureServer
    // deno-lint-ignore no-explicit-any
    configureServer(server: any) {
      // Vite 7+ per-environment module graphs: when a module is resolved
      // only in the SSR environment (e.g. virtual island modules discovered
      // during server.ssrLoadModule), the client module graph won't have it.
      // Vite's /@id/ handler looks up the client graph for browser requests,
      // so the response is empty.
      //
      // We return a post-middleware function so it runs after Vite's built-in
      // middleware. When Vite's /@id/ handler fails to find the module in the
      // client graph, the request falls through to our handler, which resolves
      // it via transformRequest and serves the result directly.
      const clientEnv = server.environments?.client;
      if (!clientEnv) return;

      return () => {
        server.middlewares.use(
          // deno-lint-ignore no-explicit-any
          async (req: any, res: any, next: (err?: unknown) => void) => {
            const url: string | undefined = req.url;
            if (!url || !url.startsWith("/@id/")) return next();

            const rawId = url.slice("/@id/".length).split("?")[0];
            const id = decodeURIComponent(rawId);
            try {
              const result = await clientEnv.transformRequest(id);
              if (result) {
                res.setHeader("Content-Type", "application/javascript");
                res.statusCode = 200;
                res.end(result.code);
                return;
              }
            } catch {
              // Not resolvable in client environment
            }
            next();
          },
        );
      };
    },
    async resolveId(id, importer) {
      // The "pre"-resolve plugin already resolved it
      if (isDenoSpecifier(id)) return;

      // Skip IDs excluded by the user (e.g. virtual modules from other plugins)
      if (isExcluded?.(id)) return;

      // @ts-ignore Vite 7+ Environment API
      const envName: string | undefined = this.environment?.name;
      const loader = await getLoader(envName);
      const cache = getCache(envName);
      return await resolveViteSpecifier(id, cache, root, loader, importer);
    },
    async load(id) {
      if (!isDenoSpecifier(id)) return;

      const { loader: mediaType, resolved } = parseDenoSpecifier(
        id,
      );

      // @ts-ignore Vite 7+ Environment API
      const envName: string | undefined = this.environment?.name;
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

      const code = textDecoder.decode(loadResult.code);
      const map = loadResult.sourceMap
        ? textDecoder.decode(loadResult.sourceMap)
        : null;

      // Rewrite https:// imports so Vite's SSR module runner doesn't
      // treat them as external URLs (ERR_UNSUPPORTED_ESM_URL_SCHEME).
      const rewritten = rewriteHttpImports(code);

      if (onLoad) {
        // @ts-ignore Vite 7+ Environment API
        const consumer: string | undefined = this.environment?.config?.consumer;
        const result = await onLoad({
          code: rewritten,
          id: specifierUrl,
          mediaType: loadResult.mediaType,
          environment: envName ?? "default",
          ssr: consumer === "server",
        });
        if (result != null) {
          // Strip JSX pragma comments so Vite's esbuild transform doesn't
          // re-process already-transformed JSX from the onLoad callback.
          const out = result as { code?: string; map?: string | null };
          if (out.code) {
            out.code = out.code
              .replace(/\/\*\*\s*@jsxRuntime\s+\w+\s*\*\//g, "")
              .replace(/\/\*\*\s*@jsxImportSource[^*]*\*\//g, "")
              .replace(/\/\*\*\s*@jsxImportSourceTypes[^*]*\*\//g, "");
          }
          return out as { code: string; map?: string | null };
        }
      }

      if (mediaType === "Json") {
        // Wrap raw JSON as a default export; source map is not applicable here.
        return `export default ${rewritten}`;
      }

      // Strip JSX pragma comments so Vite's esbuild transform doesn't
      // try to resolve npm: JSX import sources it can't handle.
      const stripped = rewritten
        .replace(/\/\*\*\s*@jsxRuntime\s+\w+\s*\*\//g, "")
        .replace(/\/\*\*\s*@jsxImportSource[^*]*\*\//g, "")
        .replace(/\/\*\*\s*@jsxImportSourceTypes[^*]*\*\//g, "");

      return { code: stripped, map };
    },
  };
}
