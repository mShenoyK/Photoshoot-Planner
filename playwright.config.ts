import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.FC_E2E_ROOT ??= path.join(
  tmpdir(),
  `framecraft-browser-${randomUUID()}`,
);
const testRoot = process.env.FC_E2E_ROOT;
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  globalTeardown: "./tests/e2e/teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
  webServer: {
    command: "pnpm dev",
    env: {
      WEB_BASE_URL: "http://localhost:3000",
      DATA_MODE: "mock",
      MOCK_DATA_FILE: path.join(testRoot, "data.json"),
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: path.join(testRoot, "objects"),
      QUEUE_DRIVER: process.env.TEST_QUEUE_DRIVER ?? "mock",
      AI_VISION_PROVIDER: "mock",
      AI_TEXT_PROVIDER: "mock",
      AI_IMAGE_PROVIDER: "mock",
      MOCK_QUEUE_AUTO_RUN: "true",
    },
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: "list",
});
