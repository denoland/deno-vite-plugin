import { Plugin } from "vite";
import prefixPlugin from "./prefixPlugin";
import mainPlugin from "./resolvePlugin";
import { DenoResolveResult } from "./resolver";

export default function denoPlugin(): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();

  return [prefixPlugin(cache), mainPlugin(cache)];
}
