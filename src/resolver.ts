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

/** Infer media type from a file path's extension (avoids a load() call). */
function inferMediaTypeFromPath(filePath: string): DenoMediaType | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "TypeScript";
    case ".tsx":
      return "TSX";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "JavaScript";
    case ".jsx":
      return "JSX";
    case ".json":
    case ".jsonc":
    case ".json5":
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
    // addEntrypoints may fail (e.g. network error) — treat that as unresolvable.
    if (
      resolved.startsWith("jsr:") || resolved.startsWith("http:") ||
      resolved.startsWith("https:")
    ) {
      try {
        await loader.addEntrypoints([resolved]);
      } catch {
        return null;
      }
      resolved = loader.resolveSync(resolved, undefined, ResolutionMode.Import);
    }
  } catch (err) {
    if (err instanceof ResolveError) return null;
    throw err;
  }

  // npm: specifiers: the original id starts with npm: but the loader may
  // resolve it to a file:// path (when nodeModulesDir is set) or keep it as npm:.
  if (id.startsWith("npm:")) {
    // Extract bare package name + subpath from the original specifier
    // e.g. "npm:preact@^10.24.0"             -> "preact"
    //      "npm:@scope/pkg@1.0.0"             -> "@scope/pkg"
    //      "npm:preact@^10.24.0/jsx-runtime"  -> "preact/jsx-runtime"
    //      "npm:@scope/pkg@1.0.0/sub"         -> "@scope/pkg/sub"
    const bare = id.slice(4);
    let name: string;
    let versionAndRest: string;
    if (bare.startsWith("@")) {
      const slashIdx = bare.indexOf("/");
      const afterSlash = bare.slice(slashIdx + 1);
      const atIdx = afterSlash.indexOf("@");
      if (atIdx === -1) {
        name = bare;
        versionAndRest = "";
      } else {
        name = bare.slice(0, slashIdx + 1 + atIdx);
        versionAndRest = afterSlash.slice(atIdx + 1);
      }
    } else {
      const atIdx = bare.indexOf("@");
      if (atIdx === -1) {
        name = bare;
        versionAndRest = "";
      } else {
        name = bare.slice(0, atIdx);
        versionAndRest = bare.slice(atIdx + 1);
      }
    }
    // Preserve subpath from the version string
    // e.g. "^10.24.0/jsx-runtime" -> append "/jsx-runtime" to name
    const subpathSlash = versionAndRest.indexOf("/");
    if (subpathSlash !== -1) {
      name += versionAndRest.slice(subpathSlash);
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

  // For file:// URLs, infer the media type from the extension to avoid
  // a redundant load() call — the load hook will call loader.load()
  // again to get the actual content.
  if (resolved.startsWith("file://")) {
    const filePath = fileURLToPath(resolved);
    return {
      id: filePath,
      kind: "esm",
      loader: inferMediaTypeFromPath(filePath),
    };
  }

  // For remote URLs (https://) we must call load() to determine the
  // media type, since the URL extension may not reflect the content type.
  const loadResult = await loader.load(
    resolved,
    RequestedModuleType.Default,
  );

  if (loadResult.kind === "external") {
    return null;
  }

  return {
    id: resolved,
    kind: "esm",
    loader: loaderMediaType(loadResult.mediaType),
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

  // Try to resolve through the Deno loader first when we have an importer.
  // This handles workspace member import maps correctly, since
  // loader.resolveSync is import-map-aware per workspace member, while
  // import.meta.resolve only sees the root deno.json import map.
  if (importer) {
    let importerUrl: string | undefined;
    if (isDenoSpecifier(importer)) {
      const { resolved: parent } = parseDenoSpecifier(importer);
      importerUrl = parent.startsWith("/")
        ? pathToFileURL(parent).href
        : parent;
    } else if (importer.startsWith("/") || /^[a-zA-Z]:/.test(importer)) {
      importerUrl = pathToFileURL(importer).href;
    }

    if (importerUrl) {
      try {
        const resolvedUrl = loader.resolveSync(
          id,
          importerUrl,
          ResolutionMode.Import,
        );

        if (resolvedUrl.startsWith("file://")) {
          const resolvedPath = fileURLToPath(resolvedUrl);
          // Don't trust Deno loader results for paths inside node_modules.
          // The loader may resolve subpath imports (e.g. "preact/jsx-runtime")
          // to the package main entry instead of the correct subpath export.
          // Let Vite's native resolver handle these — it reads package.json
          // exports maps correctly.
          if (
            !resolvedPath.includes(`${path.sep}node_modules${path.sep}`)
          ) {
            return resolvedPath;
          }
          // Fall through to let Vite handle node_modules resolution
        } else if (resolvedUrl.startsWith("npm:")) {
          // npm: results will be handled by the prefix plugin or Vite natively.
          // Don't continue processing — the loader may have dropped the subpath.
          return null;
        } else {
          // Continue resolution for non-file URLs (e.g. jsr:, https:)
          id = resolvedUrl;
        }
      } catch (err) {
        if (!(err instanceof ResolveError)) throw err;
        // Fall through to import.meta.resolve fallback
      }
    }
  }

  // Fallback: resolve bare specifiers through import.meta.resolve, which
  // consults the root deno.json import map under Deno, or Node's own
  // resolution under Node.js. This does NOT see workspace member import maps.
  if (!id.startsWith(".") && !id.startsWith("/") && !id.includes(":")) {
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

  const resolved = cache.get(id) ?? await resolveDeno(id, loader);

  // Deno cannot resolve this
  if (resolved === null) return;

  if (resolved.kind === "npm") {
    return null;
  }

  cache.set(id, resolved);

  // Remote modules must always go through our load hook — Vite/Node.js
  // can't load https:// URLs natively and would fail with
  // ERR_UNSUPPORTED_ESM_URL_SCHEME during SSR module evaluation.
  const isRemote = resolved.id.startsWith("http:") ||
    resolved.id.startsWith("https:");

  // Vite can load local files that are inside the project root with a
  // known or null loader — no need to go through our load hook.
  const isInsideRoot = resolved.id.startsWith(path.resolve(root)) &&
    !path.relative(root, resolved.id).startsWith(".");
  if (!isRemote && (resolved.loader === null || isInsideRoot)) {
    return resolved.id;
  }

  // We must load it through the deno specifier system
  return toDenoSpecifier(resolved.loader ?? "JavaScript", id, resolved.id);
}

/**
 * Prefix used to rewrite https:// import specifiers in loaded code.
 * Vite's SSR module runner treats raw https:// imports as external URLs
 * and skips resolveId, causing ERR_UNSUPPORTED_ESM_URL_SCHEME. This
 * prefix makes them opaque to Vite so they go through resolveId.
 */
export const DENO_HTTP_PREFIX = "deno-http::";

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
  // Format: "\0deno::<loader>::<id>::<resolved>"
  // Position 0 is the "\0deno" prefix, 1 is the DenoMediaType, 2 is the
  // original specifier, and the rest is the resolved path (joined in case
  // it contains "::", e.g. an https:// URL).
  const [_, loader, id, ...rest] = raw.split("::") as [
    string,
    DenoMediaType,
    string,
    ...string[],
  ];
  // Rejoin rest in case the resolved path contains "::" (unlikely but safe).
  const posixPath = rest.join("::");
  // Only normalize filesystem paths, not URLs.
  const resolved =
    posixPath.startsWith("http:") || posixPath.startsWith("https:")
      ? posixPath
      : path.normalize(posixPath);
  return { loader, id, resolved };
}
