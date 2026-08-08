import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/ dùng Playwright runner, không phải vitest.
    include: ["src/**/*.test.ts"],
  },
});
