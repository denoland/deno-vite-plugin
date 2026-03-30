import type { Plugin } from "vite";
import { type Loader, Workspace } from "@deno/loader";
import { parse as parseJsonc } from "@std/jsonc";
import fs from "node:fs";
import path from "node:path";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import type { DenoResolveResult } from "./resolver.js";

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

export default function deno(): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();

  let loaderPromise: Promise<Loader> | null = null;

  function getLoader(): Promise<Loader> {
    if (loaderPromise === null) {
      throw new Error("deno plugin: loader not initialized");
    }
    return loaderPromise;
  }

  return [
    {
      name: "deno:config",
      configResolved(config) {
        const root = path.normalize(config.root);
        const configPath = findDenoConfig(root);
        const opts = configPath ? { configPath } : {};
        loaderPromise = new Workspace(opts).createLoader();
      },
    },
    prefixPlugin(cache, getLoader),
    mainPlugin(cache, getLoader),
  ];
}
