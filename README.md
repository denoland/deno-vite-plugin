# Deno vite plugin

Plugin to enable Deno resolution inside [vite](https://github.com/vitejs/vite).

## Usage

Install this package:

```sh
# npm
npm install @deno/vite-plugin
# pnpm
pnpm install @deno/vite-plugin
# deno
deno install @deno/vite-plugin
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
