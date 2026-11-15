import { readFile, mkdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = name => readFile(new URL(`vendor/zip2d/${name}`, root), "utf8");
const html = await read("index.html");
const css = await read("styles.css");
const files = ["data.js", "engine.js", "ui_core.js", "weather.js", "ui_views.js", "live-bridge.js"];
const js = (await Promise.all(files.map(read))).join("\n").replaceAll("</script>", "<\\/script>");
const output = html.replace("/*CSS*/", () => css).replace("/*JS*/", () => js);
const dir = new URL("public/zip2d/", root);
await mkdir(dir, { recursive: true });
await writeFile(new URL("airspace.html", dir), output);
