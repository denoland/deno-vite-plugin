import { Plugin } from "vite";
import {
  type DenoMediaType,
  type DenoResolveResult,
  resolveDeno,
} from "./resolver.js";
import { type Loader, transform } from "esbuild";
import * as fsp from "node:fs/promises";
import process from "node:process";

const FIX_PROTOCOL_HTTP = /^http:\/[^/]/;

export default function denoPlugin(): Plugin {
  let root = process.cwd();

  // Module info cache
  const cache = new Map<string, DenoResolveResult>();

  return {
    name: "deno",
    configResolved(config) {
      root = config.root;
    },
    async resolveId(id, importer) {
      // Resolve import map
      if (!id.startsWith(".") && !id.startsWith("/")) {
        try {
          id = import.meta.resolve(id);
        } catch {
          // Ignore: not resolvable
        }
      }

      if (importer && isDenoSpecifier(importer)) {
        const { id: parentId, resolved: parent } = parseDenoSpecifier(importer);

        // Stich back together the full path if we're dealing with
        // an absolute path and the importer was an URL
        if (
          id.startsWith("/") &&
          (parentId.startsWith("http:") || parentId.startsWith("https:"))
        ) {
          // Vite normalizes slashes because it thinks that these are
          // always file paths.
          const fixed = FIX_PROTOCOL_HTTP.test(parentId)
            ? `http:/${parentId.slice(parentId.indexOf("/"))}`
            : `https:/${parentId.slice(parentId.indexOf("/"))}`;

          const url = new URL(fixed);
          return `${url.origin}${id}`;
        }

        const cached = cache.get(parent);
        if (cached === undefined) return;

        const found = cached.dependencies.find((dep) => dep.specifier === id);

        if (found === undefined) return;

        // Check if we need to continue resolution
        id = found.code.specifier;
        if (!id.startsWith("http://") && !id.startsWith("https://")) {
          return found.code.specifier;
        }
      }

      const resolved = await resolveDeno(id, root);

      // Deno cannot resolve this
      if (resolved === null) return;

      cache.set(resolved.id, resolved);

      // Vite can load this
      if (resolved.loader === null) return resolved.id;

      // We must load it
      return toDenoSpecifier(resolved.loader, id, resolved.id);
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

type DenoSpecifierName = string & { __brand: "deno" };

function isDenoSpecifier(str: string): str is DenoSpecifierName {
  return str.startsWith("\0deno");
}

function toDenoSpecifier(
  loader: DenoMediaType,
  id: string,
  resolved: string,
): DenoSpecifierName {
  return `\0deno::${loader}::${id}::${resolved}` as DenoSpecifierName;
}

function parseDenoSpecifier(spec: DenoSpecifierName): {
  loader: DenoMediaType;
  id: string;
  resolved: string;
} {
  const [_, loader, id, resolved] = spec.split("::") as [
    string,
    string,
    DenoMediaType,
    string,
  ];
  return { loader: loader as DenoMediaType, id, resolved };
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
