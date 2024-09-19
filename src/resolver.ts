import { exec } from "node:child_process";

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

interface ResolveError {
  specifier: string;
  error: string;
}

interface DenoInfoJsonV1 {
  version: 1;
  redirects: Record<string, string>;
  roots: string[];
  modules: Array<NpmResolvedInfo | ResolvedInfo | ResolveError>;
}

export interface DenoResolveResult {
  id: string;
  loader: DenoMediaType | null;
  dependencies: ResolvedInfo["dependencies"];
}

function isResolveError(
  info: NpmResolvedInfo | ResolvedInfo | ResolveError,
): info is ResolveError {
  return "error" in info && typeof info.error === "string";
}

export async function resolveDeno(
  id: string,
  cwd: string,
): Promise<DenoResolveResult | null> {
  // There is no JS-API in Deno to get the final file path in Deno's
  // cache directory. The `deno info` command reveals that information
  // though, so we can use that.
  const output = await new Promise<string | null>((resolve) => {
    exec(`deno fino --json '${id}'`, { cwd }, (error, stdout) => {
      if (error) resolve(null);
      else resolve(stdout);
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
      loader: mod.mediaType,
      dependencies: mod.dependencies,
    };
  } else if (mod.kind === "npm") {
    return {
      id: mod.npmPackage,
      loader: null,
      dependencies: [],
    };
  }

  throw new Error(`Unsupported: ${JSON.stringify(mod, null, 2)}`);
}
