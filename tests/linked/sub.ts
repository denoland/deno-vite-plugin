// This is a dummy file to test the linked module functionality.
//
// The two imports below exercise the linked package's *own* (member-scoped)
// import map: "@linked/" is an alias and "@std/encoding" is a jsr dependency,
// neither of which exists in the root import map. main.ts re-exports this file,
// so Vite processes it with a plain-path importer — the case that regressed
// member-scoped resolution.
import { helper } from "@linked/util.ts";
import { encodeBase64 } from "@std/encoding/base64";

export function linkedFunction() {
  // helper() -> "helper"; both imports must resolve and run for the expected
  // result, so a break in either is observable at runtime, not just at build.
  return encodeBase64(new TextEncoder().encode(helper()));
}
