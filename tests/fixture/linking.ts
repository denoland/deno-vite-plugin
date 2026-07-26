import { linkedFunction } from "linked";

// Call it at runtime: linkedFunction is implemented in the linked package via
// its own member-scoped imports (an "@linked/" alias and the "@std/encoding"
// jsr dependency), so a correct result proves those resolved and executed, not
// just that the build succeeded. "aGVscGVy" is base64("helper").
if (typeof linkedFunction === "function" && linkedFunction() === "aGVscGVy") {
  console.log("it works");
}
