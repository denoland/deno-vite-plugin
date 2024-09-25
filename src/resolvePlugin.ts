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

export default function denoPlugin(
  cache: Map<string, DenoResolveResult>,
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

      const result = await resolveViteSpecifier(id, cache, root, importer);
      console.log(id, result);
      return result;
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

      return {
        code: result.code,
        map: result.map,
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
