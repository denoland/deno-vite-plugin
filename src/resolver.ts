import { execFile } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execAsync } from "./utils.js";

export type DenoMediaType =
  | "TypeScript"
  | "TSX"
  | "JavaScript"
  | "JSX"
  | "Json";

interface ResolvedInfo {
  kind: "esm";
  local: string;
  size: number;
  mediaType: DenoMediaType;
  specifier: string;
  dependencies: Array<{
    specifier: string;
    code: {
      specifier: string;
      span: { start: unknown; end: unknown };
    };
  }>;
}

interface NpmResolvedInfo {
  kind: "npm";
  specifier: string;
  npmPackage: string;
}

interface ExternalResolvedInfo {
  kind: "external";
  specifier: string;
}

interface ResolveError {
  specifier: string;
  error: string;
}

interface DenoInfoJsonV1 {
  version: 1;
  redirects: Record<string, string>;
  roots: string[];
  modules: Array<
    NpmResolvedInfo | ResolvedInfo | ExternalResolvedInfo | ResolveError
  >;
}

export interface DenoResolveResult {
  id: string;
  kind: "esm" | "npm";
  loader: DenoMediaType | null;
  dependencies: ResolvedInfo["dependencies"];
}

function isResolveError(
  info: NpmResolvedInfo | ResolvedInfo | ExternalResolvedInfo | ResolveError,
): info is ResolveError {
  return "error" in info && typeof info.error === "string";
}

let checkedDenoInstall = false;
const DENO_BINARY = process.platform === "win32" ? "deno.exe" : "deno";

export async function resolveDeno(
  id: string,
  cwd: string,
): Promise<DenoResolveResult | null> {
  if (id.startsWith("\x00")) return null; // ignore vite virtual modules

  if (!checkedDenoInstall) {
    try {
      await execAsync(`${DENO_BINARY} --version`, { cwd });
      checkedDenoInstall = true;
    } catch {
      throw new Error(
        `Deno binary could not be found. Install Deno to resolve this error.`,
      );
    }
  }

  // There is no JS-API in Deno to get the final file path in Deno's
  // cache directory. The `deno info` command reveals that information
  // though, so we can use that.
  const output = await new Promise<string | null>((resolve, reject) => {
    execFile(DENO_BINARY, ["info", "--json", id], { cwd }, (error, stdout) => {
      if (error) {
        if (String(error).includes("Integrity check failed")) {
          reject(error);
        } else {
          resolve(null);
        }
      } else resolve(stdout);
    });
  });

  if (output === null) return null;

  const json = JSON.parse(output) as DenoInfoJsonV1;
  const actualId = json.roots[0];

  // Find the final resolved cache path. First, we need to check
  // if the redirected specifier, which represents the final specifier.
  // This is often used for `http://` imports where a server can do
  // redirects.
  const redirected = json.redirects[actualId] ?? actualId;

  // Find the module information based on the redirected speciffier
  const mod = json.modules.find((info) => info.specifier === redirected);
  if (mod === undefined) return null;

  // Specifier not found by deno
  if (isResolveError(mod)) {
    return null;
  }

  if (mod.kind === "esm") {
    return {
      id: mod.local,
      kind: mod.kind,
      loader: mod.mediaType,
      dependencies: mod.dependencies,
    };
  } else if (mod.kind === "npm") {
    return {
      id: mod.npmPackage,
      kind: mod.kind,
      loader: null,
      dependencies: [],
    };
  } else if (mod.kind === "external") {
    // Let vite handle this
    return null;
  }

  throw new Error(`Unsupported: ${JSON.stringify(mod, null, 2)}`);
}

export async function resolveViteSpecifier(
  id: string,
  cache: Map<string, DenoResolveResult>,
  posixRoot: string,
  importer?: string,
) {
  const root = path.normalize(posixRoot);

  // Resolve import map
  if (!id.startsWith(".") && !id.startsWith("/")) {
    try {
      id = import.meta.resolve(id);
    } catch {
      // Ignore: not resolvable
    }
  }

  if (importer && isDenoSpecifier(importer)) {
    const { resolved: parent } = parseDenoSpecifier(importer);

    const cached = cache.get(parent);
    if (cached === undefined) return;

    const found = cached.dependencies.find((dep) => dep.specifier === id);

    if (found === undefined) return;

    // Check if we need to continue resolution
    id = found.code.specifier;
    if (id.startsWith("file://")) {
      const idx = id.indexOf("?");
      if (idx > -1) {
        return fileURLToPath(id) + id.substring(idx);
      }
      return fileURLToPath(id);
    }
  }

  const resolved = cache.get(id) ?? await resolveDeno(id, root);

  // Deno cannot resolve this
  if (resolved === null) return;

  if (resolved.kind === "npm") {
    return null;
  }

  cache.set(resolved.id, resolved);

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

export function toDenoSpecifier(
  loader: DenoMediaType,
  id: string,
  resolved: string,
): DenoSpecifierName {
  return `\0deno::${loader}::${id}::${resolved}` as DenoSpecifierName;
}

export function parseDenoSpecifier(spec: DenoSpecifierName): {
  loader: DenoMediaType;
  id: string;
  resolved: string;
} {
  const [_, loader, id, posixPath] = spec.split("::") as [
    string,
    string,
    DenoMediaType,
    string,
  ];
  const resolved = path.normalize(posixPath);
  return { loader: loader as DenoMediaType, id, resolved };
}
