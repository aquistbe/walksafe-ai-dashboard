/**
 * Copy MapLibre GL JS's worker into public/maplibre/.
 *
 * maplibre-gl 6 ships its worker as a separate ES module rather than inlining
 * it as a Blob, and Next.js does not emit it: `new URL(..., import.meta.url)`
 * yields a hashed worker asset WITHOUT its `maplibre-gl-shared.mjs` sibling,
 * so the worker dies on its first import and the map mounts but never draws.
 * Serving both files from public/ and calling setWorkerUrl() (MapExplorer.tsx)
 * is the setup MapLibre documents for Next.js.
 *
 * Both files are needed, in the same directory: the worker imports the shared
 * chunk by relative path. Copied from node_modules on every dev/build so they
 * always match the installed version; public/maplibre/ is gitignored.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.join(
  path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")),
  "dist"
);
const dest = path.join(process.cwd(), "public", "maplibre");

mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
}
