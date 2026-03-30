2. parseDenoSpecifier type mismatch in destructuring (src/resolver.ts:227-232)

const [_, loader, id, ...rest] = raw.split("::") as [ string, string,
DenoMediaType, // ← this is the 3rd element, but it's assigned to `id`
...string[], ];

The cast says element index 2 is DenoMediaType, but the destructuring assigns it
to id. The actual loader (index 1) is typed as string. The cast doesn't match
the destructuring order — loader is DenoMediaType and id is the specifier
string. This is cosmetic since both are strings at runtime, but it's confusing
and the type assertion is wrong.

3. No source maps from @deno/loader transpilation (src/resolvePlugin.ts:48-54)

The old code returned { code, map } from esbuild/oxc transforms. The new code
just returns the transpiled code string with no source map. This will degrade
the dev-mode debugging experience for TypeScript/TSX files loaded through the
plugin. Does @deno/loader's load() return source maps that could be forwarded?

4. Cache key changed from resolved path to specifier (src/resolver.ts:185)

// Before: cache.set(resolved.id, resolved); // After: cache.set(id, resolved);

The old code keyed by the resolved file path; the new code keys by the (possibly
pre-resolution) specifier id. This means two different specifiers that resolve
to the same file won't share a cache entry, and lookups by resolved path will
miss. The cache.get(id) call on line 176 also uses the id after import map
resolution, but sub-imports resolved via resolveSync on line 162 might produce a
different string for the same module. Should verify this doesn't cause duplicate
resolution work.

5. import.meta.resolve() in Node.js context (src/resolver.ts:135)

import.meta.resolve(id) runs in the Node.js host (since this is a Vite plugin).
Under Node.js, this resolves using Node's resolution algorithm, not Deno's
import map. The comment says "Resolve import map" but this won't actually
resolve Deno import maps — @deno/loader's resolveSync would be the appropriate
way to do that. This was pre-existing behavior, but worth noting that the
migration didn't address it.

6. CI now requires Deno on all test runners (.github/workflows/ci.yml,
   tests/plugin.test.ts)

The fixture build changed from npx vite build to deno run -A .... This means CI
(and any contributor running tests locally) now requires Deno installed. The
previous approach worked with just Node.js. This is a reasonable trade-off for a
Deno plugin, but it's a breaking change for the test workflow that should be
called out.

7. skipLibCheck: true in tsconfig (tsconfig.json)

This is a blunt workaround for @deno/loader type issues. It disables type
checking for all .d.ts files, which could mask real type errors in other
dependencies. Worth a comment explaining which types are problematic, and
ideally filing upstream to fix the types.

Minor / Nits

- DENO_SPECIFIER_SUFFIX (resolver.ts:206): The #deno suffix to prevent Vite's
  JSON plugin matching is clever, but fragile — if other Vite plugins match on
  different extensions, this won't help. A comment about which specific plugin
  this works around (vite:json) is there, which is good.
- new TextDecoder().decode(loadResult.code) (resolvePlugin.ts:48): Creating a
  new TextDecoder per load call is fine for correctness but could be hoisted to
  module scope for a marginal perf improvement on many-module projects.
- Unchecked test plan item: The PR body notes scripts/test-vite-versions.sh
  across Vite 5/6/7/8 is unchecked. This should be verified before merge,
  especially since the CI fixture build approach changed.

What looks good

- Clean removal of all child_process / deno info JSON parsing code — significant
  reduction in complexity
- The npm package name extraction logic for scoped packages is correct
- Proper handling of ResolveError catch blocks (swallow resolve errors, rethrow
  others)
- The Vite 8 vite-module-runner: URL filtering is a nice forward-compat touch
- Dropping lightningcss platform binaries from the lock file is a welcome side
  effect
- Windows path handling in loader.load() with pathToFileURL is correct

During integration in Fresh itself we found these issues: Findings

The integration hit a fundamental architecture gap in @deno/vite-plugin. Fresh's
deno.ts and @deno/vite-plugin have different designs that prevent a simple swap:

1. Vite Environment API

Fresh's plugin uses Vite's Environments feature (sharedDuringBuild: true,
applyToEnvironment, this.environment.config.consumer) to run different loaders
for server vs client. @deno/vite-plugin doesn't use environments — it has a
single loader. This means:

- Fresh needs a browserLoader with platform: "browser" and preserveJsx: true for
  client code
- Fresh needs an ssrLoader with platform: "node" for server code
- @deno/vite-plugin creates one loader with no platform distinction

2. Module ID format

Both use \0deno::... virtual module IDs but with different formats:

- Fresh: \0deno::{type}::{specifier} (2 fields)
- deno-vite-plugin: \0deno::{loader}::{id}::{resolved}#deno (3 fields + suffix)

This means the isDenoSpecifier/parseDenoSpecifier functions are incompatible —
Fresh's transforms can't parse @deno/vite-plugin's IDs and vice versa.

3. resolve.noExternal: true

Fresh sets resolve.noExternal: true to prevent duplicate Preact modules.
@deno/vite-plugin doesn't set this, and Vite's default SSR behavior externalizes
bare specifiers, which breaks the module graph.

4. Babel JSX transform in load hook

Fresh applies babel transforms during load (not transform), because the code
comes from @deno/loader already transpiled from TypeScript but still containing
JSX. @deno/vite-plugin's load returns raw code without any JSX processing — it
relies on Vite's esbuild for that. But Fresh needs Preact-specific JSX with
jsxImportSource: "preact" applied via babel.

What needs to happen for Option A

Before Fresh can use @deno/vite-plugin, the plugin needs:

1. Export resolver internals — resolveViteSpecifier, isDenoSpecifier,
   parseDenoSpecifier via @deno/vite-plugin/resolver (started in the PR, just
   needs the package.json exports field)
2. Support Vite Environments — sharedDuringBuild, applyToEnvironment, and
   environment-aware loader creation (server vs client platform)
3. Standardize the specifier format — align on one format, or expose the parser
   so consumers can work with it
4. Make the plugin composable — allow consumers to hook into load results (e.g.,
   to apply babel transforms) without having to re-implement the entire load
   logic
