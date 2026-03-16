import type { Plugin } from "vite";
import { type Loader, Workspace } from "@deno/loader";
import path from "node:path";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import type { DenoResolveResult } from "./resolver.js";

export default function deno(): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();

  let loaderPromise: Promise<Loader> | null = null;
  function getLoader(root: string): Promise<Loader> {
    if (loaderPromise === null) {
      loaderPromise = new Workspace({
        configPath: path.join(root, "deno.json"),
      }).createLoader();
    }
    return loaderPromise;
  }

  return [prefixPlugin(cache, getLoader), mainPlugin(cache, getLoader)];
}
