import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export default async function teardown() {
  const root = process.env.FC_E2E_ROOT;
  if (
    root &&
    path.dirname(root) === tmpdir() &&
    /^framecraft-browser-[a-f0-9-]{36}$/.test(path.basename(root))
  )
    await rm(root, { recursive: true, force: true });
}
