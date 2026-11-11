// Builds the app as one self-contained HTML file (no server), for hosting as a
// static page.
// Usage: node scripts/build-standalone.mjs [output.html]
import { build } from "vite";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "dist-standalone/fm-standards-checker.html");
const tmp = mkdtempSync(path.join(tmpdir(), "fm-standalone-"));
process.env.VITE_STANDALONE = "1";
await build({ configFile: path.resolve("vite.config.ts"), base: "./", logLevel: "warn", build: { outDir: tmp, emptyOutDir: true, assetsInlineLimit: 100_000_000 } });

const assets = path.join(tmp, "assets");
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(assets, f), "utf8").replace(/<\/script/gi, "<\\/script")).join("\n");
const css = files.filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(assets, f), "utf8")).join("\n");

const html = `<title>FM Standards Checker</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync(out, html);
rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
