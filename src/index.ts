import type { Plugin } from "vite";
import {
  type Loader,
  type MediaType,
  Workspace,
  type WorkspaceOptions,
} from "@deno/loader";
import { parse as parseJsonc } from "@std/jsonc";
import fs from "node:fs";
import path from "node:path";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import { type DenoResolveResult, isDenoSpecifier } from "./resolver.js";

export type { MediaType } from "@deno/loader";

export interface LoadContext {
  /** The transpiled code from @deno/loader. */
  code: string;
  /** The module specifier. */
  id: string;
  /** The media type of the original source. */
  mediaType: MediaType;
  /** The Vite environment name (e.g. "client", "ssr"). */
  environment: string;
  /** Whether this is a server-side environment. */
  ssr: boolean;
}

export type OnLoadResult =
  | { code: string; map?: string | null }
  | null
  | undefined
  | void;

export interface DenoPluginOptions {
  /**
   * Per-environment Workspace options. Keys are Vite environment names
   * (e.g. "client", "ssr"). Unmatched environments use the default options.
   *
   * @example
   * ```ts
   * deno({
   *   environments: {
   *     ssr: { platform: "node" },
   *     client: { platform: "browser", preserveJsx: true },
   *   },
   * })
   * ```
   */
  environments?: Record<string, Omit<WorkspaceOptions, "configPath">>;

  /**
   * Default Workspace options applied to all environments unless
   * overridden by `environments`.
   */
  workspaceOptions?: Omit<WorkspaceOptions, "configPath">;

  /**
   * Hook called after @deno/loader transpiles a module. Return
   * `{ code, map? }` to replace the output, or `null`/`undefined`
   * to use the default.
   */
  onLoad?: (ctx: LoadContext) => OnLoadResult | Promise<OnLoadResult>;

  /**
   * Module IDs to exclude from Deno resolution. Matching IDs are skipped
   * by both `resolveId` hooks, letting other plugins handle them.
   *
   * Accepts a string prefix, a RegExp, or an array of either. String
   * values are matched as prefixes (e.g. `"fresh-island"` matches
   * `"fresh-island::Counter"`).
   *
   * @example
   * ```ts
   * deno({ exclude: ["fresh-island", "fresh:"] })
   * deno({ exclude: /^fresh-island::/ })
   * ```
   */
  exclude?: string | RegExp | (string | RegExp)[];
}

/**
 * Walk up from `startDir` to find the nearest deno.json or deno.jsonc.
 * If a config with a "workspace" field is found, return that (the workspace
 * root). Otherwise return the nearest config file found.
 */
function findDenoConfig(startDir: string): string | null {
  let nearest: string | null = null;
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      const candidate = path.join(dir, name);
      try {
        const content = fs.readFileSync(candidate, "utf-8");
        if (nearest === null) nearest = candidate;

        const json = parseJsonc(content) as Record<string, unknown>;
        if (json.workspace) {
          // Found the workspace root
          return candidate;
        }
      } catch {
        // File doesn't exist or isn't valid JSON, continue
      }
    }

    if (dir === root) break;
    dir = path.dirname(dir);
  }

  return nearest;
}

function buildExcludeMatcher(
  exclude?: string | RegExp | (string | RegExp)[],
): ((id: string) => boolean) | null {
  if (!exclude) return null;
  const patterns = Array.isArray(exclude) ? exclude : [exclude];
  if (patterns.length === 0) return null;
  return (id: string) =>
    patterns.some((p) => typeof p === "string" ? id.startsWith(p) : p.test(id));
}

export default function deno(options?: DenoPluginOptions): Plugin[] {
  const loaders = new Map<string, Promise<Loader>>();
  // Per-environment resolution caches. Different environments may have
  // different WorkspaceOptions (e.g. platform: "node" vs "browser"),
  // so the same specifier can resolve differently across environments.
  const caches = new Map<string, Map<string, DenoResolveResult>>();
  let configPath: string | null = null;
  let configResolved = false;

  function createLoaderForEnv(envName: string): Promise<Loader> {
    const envOpts = options?.environments?.[envName];
    const baseOpts = options?.workspaceOptions ?? {};
    const wsOpts: WorkspaceOptions = {
      ...baseOpts,
      ...envOpts,
      ...(configPath ? { configPath } : {}),
    };
    return new Workspace(wsOpts).createLoader();
  }

  function getLoader(envName?: string): Promise<Loader> {
    // When envName is undefined (Vite <7 or outside environment context),
    // use a sentinel key that won't collide with real environment names.
    const key = envName ?? "__default__";
    let promise = loaders.get(key);
    if (!promise) {
      if (!configResolved) {
        throw new Error("deno plugin: loader not initialized");
      }
      promise = createLoaderForEnv(key);
      loaders.set(key, promise);
    }
    return promise;
  }

  function getCache(envName?: string): Map<string, DenoResolveResult> {
    const key = envName ?? "__default__";
    let cache = caches.get(key);
    if (!cache) {
      cache = new Map();
      caches.set(key, cache);
    }
    return cache;
  }

  const isExcluded = buildExcludeMatcher(options?.exclude);

  return [
    {
      name: "deno:config",
      configResolved(config) {
        const root = path.normalize(config.root);
        configPath = findDenoConfig(root);
        configResolved = true;
      },
    },
    // Prevent Vite's esbuild transform from re-processing code that
    // was already transpiled by @deno/loader. Without this, esbuild
    // sees the .tsx/.jsx extension on deno:: virtual modules and runs
    // its own JSX transform, overriding onLoad callback output.
    {
      name: "deno:skip-esbuild",
      enforce: "pre" as const,
      transform(code: string, id: string) {
        if (isDenoSpecifier(id)) {
          return { code };
        }
      },
    },
    prefixPlugin(getCache, getLoader, isExcluded),
    mainPlugin(getCache, getLoader, options?.onLoad, isExcluded),
  ];
}
