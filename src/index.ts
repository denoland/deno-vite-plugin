import type { Plugin } from "vite";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import type { DenoResolveResult } from "./resolver.js";

export default function deno(): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();

  return [prefixPlugin(cache), mainPlugin(cache)];
}
