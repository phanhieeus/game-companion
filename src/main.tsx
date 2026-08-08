import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { AdminApp } from "./admin/AdminApp";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Không tìm thấy #root");

/**
 * Không kéo router vào chỉ vì có hai trang.
 *
 * App này có đúng hai màn hình gốc: người chơi và người quan sát (C-023). Một
 * phép so chuỗi là đủ; thêm react-router là thêm một phụ thuộc, một khái niệm,
 * và một chỗ để hỏng — cho thứ chưa ai xin.
 */
const isAdmin = window.location.pathname.replace(/\/+$/, "") === "/admin";

createRoot(root).render(
  <StrictMode>{isAdmin ? <AdminApp /> : <App />}</StrictMode>,
);
