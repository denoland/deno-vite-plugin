// deno-lint-ignore no-import-prefix no-unversioned-import
import { signal } from "npm:@preact/signals";

if (typeof signal === "function") {
  console.log("it works");
}
