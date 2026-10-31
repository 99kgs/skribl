/**
 * Прописывает SKRIBBL_BUILD в index.html (git short hash или timestamp).
 * Запускай перед деплоем: node scripts/stamp-build.mjs
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "..", "index.html");

let build;
try {
  build = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  build = String(Date.now());
}

let html = fs.readFileSync(indexPath, "utf8");
html = html.replace(
  /<meta name="skribbl-build" content="[^"]*">/,
  `<meta name="skribbl-build" content="${build}">`
);
html = html.replace(/<!-- SKRIBBL_BUILD:[^>]*-->/, `<!-- SKRIBBL_BUILD:${build} -->`);
fs.writeFileSync(indexPath, html);
console.log("SKRIBBL_BUILD =", build);
