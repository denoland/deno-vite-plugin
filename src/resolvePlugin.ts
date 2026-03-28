import { type Loader, RequestedModuleType } from "@deno/loader";
import type { Plugin } from "vite";
import {
  type DenoResolveResult,
  isDenoSpecifier,
  parseDenoSpecifier,
  resolveViteSpecifier,
} from "./resolver.js";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const textDecoder = new TextDecoder();

export default function denoPlugin(
  cache: Map<string, DenoResolveResult>,
  getLoader: () => Promise<Loader>,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno",
    configResolved(config) {
      // Root path given by Vite always uses posix separators.
      root = path.normalize(config.root);
    },
    async resolveId(id, importer) {
      // The "pre"-resolve plugin already resolved it
      if (isDenoSpecifier(id)) return;

      const loader = await getLoader();
      return await resolveViteSpecifier(id, cache, root, loader, importer);
    },
    async load(id) {
      if (!isDenoSpecifier(id)) return;

      const { loader: mediaType, resolved } = parseDenoSpecifier(
        id,
      );

      const denoLoader = await getLoader();
      const loadResult = await denoLoader.load(
        resolved.startsWith("/") || /^[a-zA-Z]:/.test(resolved)
          ? pathToFileURL(resolved).href
          : resolved,
        RequestedModuleType.Default,
      );
      if (loadResult.kind === "external") return;

      // TODO: @deno/loader's load() doesn't return source maps, so
      // dev-mode debugging for remote TypeScript modules is degraded.
      const code = textDecoder.decode(loadResult.code);

      if (mediaType === "Json") {
        return `export default ${code}`;
      }

      return code;
    },
  };
}
