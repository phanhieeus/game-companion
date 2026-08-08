import { defineConfig, devices } from "@playwright/test";

/**
 * E2E chạy trên Chromium với SpeechRecognition giả (xem e2e/fakeSpeech.ts).
 *
 * Không test được STT thật: Web Speech API trong Chromium phụ thuộc dịch vụ
 * nhận dạng của Google, không có sẵn trong bản Playwright tải về. Phần đó phải
 * kiểm chứng bằng tay trên Chrome thật.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5174",
    // Điện thoại là thiết bị chính — test ở kích thước đó.
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
