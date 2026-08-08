import { defineConfig, devices } from "@playwright/test";

/**
 * E2E chạy trên Chromium với SpeechRecognition giả (xem e2e/fakeSpeech.ts).
 *
 * Không test được STT thật: Web Speech API trong Chromium phụ thuộc dịch vụ
 * nhận dạng của Google, không có sẵn trong bản Playwright tải về. Phần đó phải
 * kiểm chứng bằng tay trên Chrome thật.
 *
 * Từ ADR 13, dữ liệu và agent nằm ở server nên e2e phải chạy CẢ BACKEND THẬT:
 * ba tiến trình — web, api (FastAPI, ADR 16), và một Gemini giả. Thứ duy nhất
 * bị giả là model; HTTP, tool layer, chốt HITL và lưu đĩa đều là code thật.
 *
 * Không một assertion nào trong e2e biết backend viết bằng ngôn ngữ gì — đó
 * chính là điều làm chúng đáng tin khi đổi ngôn ngữ.
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
  webServer: [
    {
      command: "node e2e/fakeGeminiServer.ts",
      url: "http://localhost:8799/__script",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Thư mục dữ liệu riêng: test không được đụng vào phiên đang chơi thật.
      command:
        ".venv/bin/uvicorn api.main:app --port 8788 --log-level warning",
      env: {
        DATA_DIR: ".e2e-data",
        E2E_RESET: "1",
        GEMINI_API_KEY: "fake-key-for-e2e",
        GEMINI_BASE_URL: "http://localhost:8799",
      },
      url: "http://localhost:8788/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npx vite --port 5174",
      env: { VITE_API_TARGET: "http://localhost:8788" },
      url: "http://localhost:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
