// deno-lint-ignore no-import-prefix no-unversioned-import
import { join } from "jsr:@std/path";

if (typeof join === "function") {
  console.log("it works");
}
