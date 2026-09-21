import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
// Ship only runtime assets, never repository contents or local working files.
const assets = [
  "index.html", "styles.css", "app.js", "puzzle-utils.mjs", "game-engine.mjs",
  "progress-store.mjs", "sharing.mjs", "entitlements.mjs", "sw.js",
  "manifest.webmanifest", "icons", "jwordl_tier1_expanded_core_vocab_4to6.json",
  "bwordible_allowed_guesses_4to6.json",
];
await Promise.all(assets.map((file) => cp(file, `dist/${file}`, { recursive: true })));
await build({ entryPoints: ["native.mjs"], outfile: "dist/native.mjs", bundle: true, format: "esm", target: "es2022" });
