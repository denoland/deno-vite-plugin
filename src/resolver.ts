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

/**
 * Compute a file:// referrer URL for a *plain-file* importer, so that a
 * bare/aliased specifier can be resolved against the importing file's
 * workspace-member import map. Returns undefined when the importer is not a
 * real project source that should carry a member scope.
 *
 * Only bare/aliased specifiers consult the import map, so relative and
 * absolute specifiers are left to Vite. Vite's own virtual/URL-ish ids
 * ("/@fs/…", "/@id/…", "\0…") are not real paths, and dependencies under
 * node_modules must keep resolving through Vite's pipeline rather than being
 * reinterpreted against a nested deno.json — both are excluded.
 */
function memberReferrerUrl(
  id: string,
  importer: string | undefined,
): string | undefined {
  if (importer === undefined || isDenoSpecifier(importer)) return undefined;
  if (id.startsWith(".") || id.startsWith("/")) return undefined;

  const importerPath = importer.split("?")[0];
  if (!path.isAbsolute(importerPath) || importerPath.startsWith("/@")) {
    return undefined;
  }
  if (importerPath.includes("/node_modules/")) return undefined;

  return pathToFileURL(importerPath).href;
}

export async function resolveViteSpecifier(
  id: string,
  cache: Map<string, DenoResolveResult>,
  posixRoot: string,
  loader: Loader,
  importer?: string,
) {
  const root = path.normalize(posixRoot);

  // When a Deno module re-exports a local file, that file is handed back to
  // Vite as a plain path (see the isInsideRoot branch below), so its own
  // imports arrive here with a plain-path importer and no Deno context.
  // Resolve bare/aliased specifiers relative to that importer so a workspace
  // member's own import map is honored: a member's `imports` are *scoped* to
  // that member's directory (e.g. an "@ui/" alias, or a jsr:/npm: dependency
  // declared in the member's deno.json), so they are only resolvable when the
  // referrer is known. This runs before the import.meta.resolve heuristic
  // below so a member-scoped entry wins over the root map on a name collision.
  const referrerUrl = memberReferrerUrl(id, importer);
  let referrerResolved = false;
  if (referrerUrl !== undefined) {
    try {
      id = loader.resolveSync(id, referrerUrl, ResolutionMode.Import);
      referrerResolved = true;
    } catch (err) {
      if (!(err instanceof ResolveError)) throw err;
      // Not in the member scope either — fall through to the referrer-less
      // resolution below so the root map still gets a chance.
    }
  }

  // Resolve import map — when running under Deno, import.meta.resolve
  // consults the import map from deno.json, allowing bare specifiers
  // (e.g. "preact") to be mapped to "npm:preact@^10". Under Node.js this
  // falls back to Node's own resolution (package.json imports/exports).
  if (!referrerResolved && !id.startsWith(".") && !id.startsWith("/")) {
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
