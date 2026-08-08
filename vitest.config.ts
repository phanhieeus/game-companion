import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/ dùng Playwright runner, không phải vitest.
    // Miền nghiệp vụ + tool layer + agent sống ở server/ từ ADR 13.
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
