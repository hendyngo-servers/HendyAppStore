import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

const outfile = "apps/web-admin/automation.bundle.js";
await mkdir("apps/web-admin", { recursive: true });
await build({
  entryPoints: ["apps/web-admin/src/automation-entry.tsx"],
  outfile,
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  jsx: "automatic",
  legalComments: "none",
  logLevel: "info"
});
console.log("Built secure Admin React bundle: " + outfile);
