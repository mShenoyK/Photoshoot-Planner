import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

it("resolves Prisma CLI and client from the schema workspace without triggering auto-install", async () => {
  // Prisma 6 resolves package roots with preserveSymlinks and rejects a client
  // reached through multiple parents relative to the CLI package root. Exercise
  // the installed pnpm layout, not just the dependency declarations.
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--preserve-symlinks",
      "-e",
      `const path = require("node:path");
     const cli = path.dirname(require.resolve("prisma/package.json"));
     const client = path.dirname(require.resolve("@prisma/client/package.json"));
     console.log(JSON.stringify({cli,client,relative:path.relative(cli,client).split(path.sep),cliVersion:require("prisma/package.json").version,clientVersion:require("@prisma/client/package.json").version}));`,
    ],
    { cwd: path.resolve("packages/database") },
  );
  const found = JSON.parse(stdout);
  expect(found.cli).toBe(path.resolve("packages/database/node_modules/prisma"));
  expect(found.client).toBe(
    path.resolve("packages/database/node_modules/@prisma/client"),
  );
  expect(found.relative[0]).toBe("..");
  expect(found.relative[1]).not.toBe("..");
  expect(found.cliVersion).toBe(found.clientVersion);
  expect(found.cliVersion).toBe("6.19.0");
});
