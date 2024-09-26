import { Plugin } from "vite";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import { DenoResolveResult } from "./resolver.js";

export default function denoPlugin(): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();

  return [prefixPlugin(cache), mainPlugin(cache)];
}
