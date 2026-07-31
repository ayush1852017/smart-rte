import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [
      "e2e/**",
      "test-results/**",
      "playwright-report/**",
      "node_modules/**",
      "dist/**",
    ],
  },
});
