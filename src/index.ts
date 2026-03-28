import type { Plugin } from "vite";
import {
  type Loader,
  type MediaType,
  Workspace,
  type WorkspaceOptions,
} from "@deno/loader";
import path from "node:path";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import type { DenoResolveResult } from "./resolver.js";

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
  onLoad?: (ctx: LoadContext) => OnLoadResult;
}

export default function deno(options?: DenoPluginOptions): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();

  const loaders = new Map<string, Promise<Loader>>();
  let configRoot: string | null = null;

  function createLoaderForEnv(envName: string): Promise<Loader> {
    const root = configRoot!;
    const envOpts = options?.environments?.[envName];
    const baseOpts = options?.workspaceOptions ?? {};
    const wsOpts: WorkspaceOptions = {
      ...baseOpts,
      ...envOpts,
      configPath: path.join(root, "deno.json"),
    };
    return new Workspace(wsOpts).createLoader();
  }

  function getLoader(envName?: string): Promise<Loader> {
    const key = envName ?? "__default__";
    let promise = loaders.get(key);
    if (!promise) {
      if (configRoot === null) {
        throw new Error("deno plugin: loader not initialized");
      }
      promise = createLoaderForEnv(key);
      loaders.set(key, promise);
    }
    return promise;
  }

  return [
    {
      name: "deno:config",
      configResolved(config) {
        configRoot = path.normalize(config.root);
      },
    },
    prefixPlugin(cache, getLoader),
    mainPlugin(cache, getLoader, options?.onLoad),
  ];
}
