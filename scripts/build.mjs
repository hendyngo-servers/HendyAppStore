import { mkdir, cp, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const output = "dist/pages";
await rm("dist", { recursive: true, force: true });
await mkdir(output, { recursive: true });
const source = "apps/web-user";
await copyFile(`${source}/index.html`, `${output}/index.html`);
await copyFile(`${source}/config.js`, `${output}/config.js`);
await copyFile(`${source}/_headers`, `${output}/_headers`);
await copyFile(`${source}/_redirects`, `${output}/_redirects`);
await cp(`${source}/src`, `${output}/web-user/src`, { recursive: true });
await copyFile(`${source}/favicon.svg`, `${output}/web-user/favicon.svg`);
if (!existsSync(`${output}/web-user/src/app.js`)) throw new Error("Public app entry point was not copied.");
console.log("Built public Pages bundle at dist/pages. Admin remains in the Access-gated Worker asset bundle.");
