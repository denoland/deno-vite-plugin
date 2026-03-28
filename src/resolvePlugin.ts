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

export default function denoPlugin(
  cache: Map<string, DenoResolveResult>,
  getLoader: (root: string) => Promise<Loader>,
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

      const loader = await getLoader(root);
      return await resolveViteSpecifier(id, cache, root, loader, importer);
    },
    async load(id) {
      if (!isDenoSpecifier(id)) return;

      const { loader: mediaType, resolved, id: specifier } = parseDenoSpecifier(
        id,
      );

      const denoLoader = await getLoader(root);
      const loadResult = await denoLoader.load(
        resolved.startsWith("/") ? "file://" + resolved : resolved,
        RequestedModuleType.Default,
      );
      if (loadResult.kind === "external") return;

      const code = new TextDecoder().decode(loadResult.code);

      if (mediaType === "Json") {
        return `export default ${code}`;
      }

      return code;
    },
  };
}
