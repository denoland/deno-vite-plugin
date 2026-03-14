import type { Plugin } from "vite";
import {
  type DenoMediaType,
  type DenoResolveResult,
  isDenoSpecifier,
  parseDenoSpecifier,
  resolveViteSpecifier,
} from "./resolver.js";
import * as fsp from "node:fs/promises";
import process from "node:process";
import path from "node:path";

import type { SourceMapInput } from "rollup";

type TransformFn = (
  code: string,
  filename: string,
  options: Record<string, unknown>,
) => Promise<{ code: string; map: SourceMapInput }>;

// Use Vite's built-in transform instead of depending on esbuild directly.
// Vite 8+ provides transformWithOxc, older versions provide transformWithEsbuild.
async function loadTransform(): Promise<TransformFn> {
  try {
    // deno-lint-ignore no-explicit-any
    const vite = await import("vite") as any;
    if (vite.transformWithOxc) return vite.transformWithOxc;
  } catch {
    // not available
  }
  const { transformWithEsbuild } = await import("vite");
  return transformWithEsbuild as TransformFn;
}

const transformFn = loadTransform();

export default function denoPlugin(
  cache: Map<string, DenoResolveResult>,
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

      return await resolveViteSpecifier(id, cache, root, importer);
    },
    async load(id) {
      if (!isDenoSpecifier(id)) return;

      const { loader, resolved } = parseDenoSpecifier(id);

      const content = await fsp.readFile(resolved, "utf-8");
      if (loader === "JavaScript") return content;
      if (loader === "Json") {
        return `export default ${content}`;
      }

      const transform = await transformFn;
      const ext = mediaTypeToExt(loader);
      const result = await transform(content, `source${ext}`, {});

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

function mediaTypeToExt(media: DenoMediaType): string {
  switch (media) {
    case "JSX":
      return ".jsx";
    case "JavaScript":
      return ".js";
    case "Json":
      return ".json";
    case "TSX":
      return ".tsx";
    case "TypeScript":
      return ".ts";
  }
}
