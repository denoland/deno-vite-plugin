import { Plugin } from "vite";
import {
  type DenoMediaType,
  type DenoResolveResult,
  isDenoSpecifier,
  parseDenoSpecifier,
  resolveViteSpecifier,
} from "./resolver.js";
import { type Loader, transform } from "esbuild";
import * as fsp from "node:fs/promises";
import process from "node:process";
import Lock from "./lock.js";

export default function denoPlugin(
  cache: Map<string, DenoResolveResult>,
  lock: Lock,
): Plugin {
  let root = process.cwd();

  return {
    name: "deno",
    configResolved(config) {
      root = config.root;
    },
    async resolveId(id, importer) {
      // The "pre"-resolve plugin already resolved it
      if (isDenoSpecifier(id)) return;

      return await resolveViteSpecifier(id, cache, root, lock, importer);
    },
    async load(id) {
      if (!isDenoSpecifier(id)) return;

      const { loader, resolved } = parseDenoSpecifier(id);

      const content = await fsp.readFile(resolved, "utf-8");
      if (loader === "JavaScript") return content;
      if (loader === "Json") {
        return `export default ${content}`;
      }

      const result = await transform(content, {
        format: "esm",
        loader: mediaTypeToLoader(loader),
        logLevel: "debug",
      });

      // Issue: https://github.com/denoland/deno-vite-plugin/issues/38
      // Esbuild uses an empty string as empty value and vite expects
      // `null` to be the empty value. This seems to be only the case in
      // `dev` mode
      const map = result.map === "" ? null : result.map;

      return {
        code: result.code,
        map,
      };
    },
  };
}

function mediaTypeToLoader(media: DenoMediaType): Loader {
  switch (media) {
    case "JSX":
      return "jsx";
    case "JavaScript":
      return "js";
    case "Json":
      return "json";
    case "TSX":
      return "tsx";
    case "TypeScript":
      return "ts";
  }
}
