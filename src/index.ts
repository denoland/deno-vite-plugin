import { Plugin } from "vite";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";
import { DenoResolveResult } from "./resolver.js";
import Lock from "./lock.js";

export default function deno(): Plugin[] {
  const cache = new Map<string, DenoResolveResult>();
  const lock = new Lock();

  return [prefixPlugin(cache, lock), mainPlugin(cache, lock)];
}
