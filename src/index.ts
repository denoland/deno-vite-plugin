import type { Plugin } from "vite";
import { type Loader, Workspace } from "@deno/loader";
import path from "node:path";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import type { DenoResolveResult } from "./resolver.js";

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
        loaderPromise = new Workspace({
          configPath: path.join(root, "deno.json"),
        }).createLoader();
      },
    },
    prefixPlugin(cache, getLoader),
    mainPlugin(cache, getLoader),
  ];
}
