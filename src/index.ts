import { Plugin } from "vite";
import prefixPlugin from "./prefixPlugin.js";
import mainPlugin from "./resolvePlugin.js";

export default function denoPlugin(): Plugin[] {
  return [prefixPlugin(), mainPlugin()];
}
