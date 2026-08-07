import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // cho phép mở từ điện thoại trong cùng mạng LAN
    proxy: {
      // Gemini API key nằm ở server, không bao giờ xuống trình duyệt.
      "/api": "http://localhost:8787",
    },
  },
});
