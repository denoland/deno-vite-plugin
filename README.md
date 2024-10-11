# Deno vite plugin

Plugin to enable Deno resolution inside [vite](https://github.com/vitejs/vite).
It supports:

- Alias mappings in `deno.json`
- `npm:` specifier
- `jsr:` specifier
- `http:` and `https:` specifiers

## Limitations

Deno specific resolution cannot be used in `vite.config.ts` because it's not
possible to intercept the bundling process of the config file in vite.

## Usage

Install this package:

```sh
# npm
npm install @deno/vite-plugin
# pnpm
pnpm install @deno/vite-plugin
# deno
deno install npm:@deno/vite-plugin
```

Add the plugin to your vite configuration file `vite.config.ts`:

```diff
  import { defineConfig } from "vite";
+ import deno from "@deno/vite-plugin";

  export default defineConfig({
+   plugins: [deno()],
  });
```

## License

MIT, see [the license file](./LICENSE).
