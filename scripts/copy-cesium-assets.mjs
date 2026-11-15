import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules/cesium/Build/Cesium");
const target = join(root, "public/Cesium");
await mkdir(target, { recursive: true });
for (const folder of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  await cp(join(source, folder), join(target, folder), { recursive: true, force: true });
}
