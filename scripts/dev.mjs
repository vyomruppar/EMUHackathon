import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const preview = process.argv.includes("--preview");
const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env.local", "server/index.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(join(root, "node_modules/.bin/vite"), [preview ? "preview" : "--host", ...(preview ? [] : ["127.0.0.1"])], { cwd: root, stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) child.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
