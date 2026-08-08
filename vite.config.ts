import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // cho phép mở từ điện thoại trong cùng mạng LAN
    proxy: {
      // Toàn bộ miền nghiệp vụ nằm ở server (ADR 13); API key không bao giờ
      // xuống trình duyệt. E2E trỏ sang cổng khác qua VITE_API_TARGET.
      "/api": process.env.VITE_API_TARGET || "http://localhost:8787",
    },
  },
});
