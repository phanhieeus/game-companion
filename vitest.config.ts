import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/ dùng Playwright runner, không phải vitest.
    // Miền nghiệp vụ + tool layer + agent chạy bằng Python từ ADR 16 — xem pytest.
    include: ["src/**/*.test.ts"],
  },
});
