// deno-lint-ignore no-import-prefix
import { render } from "https://esm.sh/preact";

if (typeof render === "function") {
  console.log("it works");
}
