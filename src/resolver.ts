import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Loader,
  MediaType,
  RequestedModuleType,
  ResolutionMode,
  ResolveError,
} from "@deno/loader";

export type DenoMediaType =
  | "TypeScript"
  | "TSX"
  | "JavaScript"
  | "JSX"
  | "Json";

export interface DenoResolveResult {
  id: string;
  kind: "esm" | "npm";
  loader: DenoMediaType | null;
}

function loaderMediaType(mt: MediaType): DenoMediaType | null {
  switch (mt) {
    case MediaType.TypeScript:
    case MediaType.Mts:
    case MediaType.Cts:
    case MediaType.Dts:
    case MediaType.Dmts:
    case MediaType.Dcts:
      return "TypeScript";
    case MediaType.Tsx:
      return "TSX";
    case MediaType.JavaScript:
    case MediaType.Mjs:
    case MediaType.Cjs:
      return "JavaScript";
    case MediaType.Jsx:
      return "JSX";
    case MediaType.Json:
    case MediaType.Jsonc:
    case MediaType.Json5:
      return "Json";
    default:
      return null;
  }
}

export async function resolveDeno(
  id: string,
  loader: Loader,
): Promise<DenoResolveResult | null> {
  if (id.startsWith("\x00")) return null; // ignore vite virtual modules

  let resolved: string;
  try {
    resolved = loader.resolveSync(id, undefined, ResolutionMode.Import);
    // If resolveSync returns a jsr: or http(s): URL that hasn't been graphed
    // yet, add it as an entrypoint and resolve again to get the final URL.
    if (
      resolved.startsWith("jsr:") || resolved.startsWith("http:") ||
      resolved.startsWith("https:")
    ) {
      await loader.addEntrypoints([resolved]);
      resolved = loader.resolveSync(resolved, undefined, ResolutionMode.Import);
    }
  } catch (err) {
    if (err instanceof ResolveError) return null;
    throw err;
  }

  // npm: specifiers: the original id starts with npm: but the loader may
  // resolve it to a file:// path (when nodeModulesDir is set) or keep it as npm:.
  if (id.startsWith("npm:")) {
    // Extract bare package name from the original specifier
    // e.g. "npm:preact@^10.24.0" -> "preact"
    //      "npm:@scope/pkg@1.0.0" -> "@scope/pkg"
    const bare = id.slice(4);
    let name: string;
    if (bare.startsWith("@")) {
      const slashIdx = bare.indexOf("/");
      const afterSlash = bare.slice(slashIdx + 1);
      const atIdx = afterSlash.indexOf("@");
      name = atIdx === -1 ? bare : bare.slice(0, slashIdx + 1 + atIdx);
    } else {
      const atIdx = bare.indexOf("@");
      name = atIdx === -1 ? bare : bare.slice(0, atIdx);
    }
    return {
      id: name,
      kind: "npm",
      loader: null,
    };
  }

  if (resolved.startsWith("node:")) {
    return null;
  }

  // For file:// and https:// URLs, get the media type via load
  const loadResult = await loader.load(
    resolved,
    RequestedModuleType.Default,
  );

  if (loadResult.kind === "external") {
    return null;
  }

  const mediaType = loaderMediaType(loadResult.mediaType);
  const filePath = resolved.startsWith("file://")
    ? fileURLToPath(resolved)
    : resolved;

  return {
    id: filePath,
    kind: "esm",
    loader: mediaType,
  };
}

export async function resolveViteSpecifier(
  id: string,
  cache: Map<string, DenoResolveResult>,
  posixRoot: string,
  loader: Loader,
  importer?: string,
) {
  const root = path.normalize(posixRoot);

  // Resolve import map
  if (!id.startsWith(".") && !id.startsWith("/")) {
    try {
      const resolved = import.meta.resolve(id);
      // Only use the result if it's a scheme the loader understands.
      // Vite 8's module runner returns vite-module-runner: URLs.
      if (
        resolved.startsWith("file:") ||
        resolved.startsWith("http:") ||
        resolved.startsWith("https:") ||
        resolved.startsWith("npm:") ||
        resolved.startsWith("jsr:")
      ) {
        id = resolved;
      }
    } catch {
      // Ignore: not resolvable
    }
  }

  if (importer && isDenoSpecifier(importer)) {
    const { resolved: parent } = parseDenoSpecifier(importer);

    // Resolve the sub-import relative to its parent module
    const parentUrl = parent.startsWith("/")
      ? pathToFileURL(parent).href
      : parent;

    let resolvedUrl: string;
    try {
      resolvedUrl = loader.resolveSync(id, parentUrl, ResolutionMode.Import);
    } catch (err) {
      if (err instanceof ResolveError) return;
      throw err;
    }

    if (resolvedUrl.startsWith("file://")) {
      return fileURLToPath(resolvedUrl);
    }

    // Continue resolution for non-file URLs (e.g. https:)
    id = resolvedUrl;
  }

  const resolved = cache.get(id) ?? await resolveDeno(id, loader);

  // Deno cannot resolve this
  if (resolved === null) return;

  if (resolved.kind === "npm") {
    return null;
  }

  cache.set(id, resolved);

  // Vite can load this
  if (
    resolved.loader === null ||
    resolved.id.startsWith(path.resolve(root)) &&
      !path.relative(root, resolved.id).startsWith(".")
  ) {
    return resolved.id;
  }

  // We must load it
  return toDenoSpecifier(resolved.loader, id, resolved.id);
}

export type DenoSpecifierName = string & { __brand: "deno" };

export function isDenoSpecifier(str: string): str is DenoSpecifierName {
  return str.startsWith("\0deno");
}

const DENO_SPECIFIER_SUFFIX = "#deno";

export function toDenoSpecifier(
  loader: DenoMediaType,
  id: string,
  resolved: string,
): DenoSpecifierName {
  // Append suffix to prevent Vite's built-in plugins (e.g. vite:json)
  // from matching the virtual module ID by file extension.
  return `\0deno::${loader}::${id}::${resolved}${DENO_SPECIFIER_SUFFIX}` as DenoSpecifierName;
}

export function parseDenoSpecifier(spec: DenoSpecifierName): {
  loader: DenoMediaType;
  id: string;
  resolved: string;
} {
  // Strip the suffix before parsing
  const raw = spec.endsWith(DENO_SPECIFIER_SUFFIX)
    ? spec.slice(0, -DENO_SPECIFIER_SUFFIX.length)
    : spec;
  const [_, loader, id, ...rest] = raw.split("::") as [
    string,
    string,
    DenoMediaType,
    ...string[],
  ];
  // Rejoin rest in case the resolved path contains "::" (unlikely but safe).
  const posixPath = rest.join("::");
  // Only normalize filesystem paths, not URLs.
  const resolved =
    posixPath.startsWith("http:") || posixPath.startsWith("https:")
      ? posixPath
      : path.normalize(posixPath);
  return { loader: loader as DenoMediaType, id, resolved };
}
