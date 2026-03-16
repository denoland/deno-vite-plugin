// deno-lint-ignore no-import-prefix no-unversioned-import
import { render } from "npm:preact";

if (typeof render === "function") {
  console.log("it works");
}
