import { signal } from "npm:@preact/signals";

if (typeof signal === "function") {
  console.log("it works");
}
