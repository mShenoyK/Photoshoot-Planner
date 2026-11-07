import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      globals: { self: "readonly", caches: "readonly", fetch: "readonly" },
    },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
);
