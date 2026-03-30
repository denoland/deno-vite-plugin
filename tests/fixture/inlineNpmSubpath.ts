// deno-lint-ignore no-import-prefix
import { useState } from "npm:preact@^10.24.0/hooks";

if (typeof useState === "function") {
  console.log("it works");
}
