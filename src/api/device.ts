/**
 * Định danh thiết bị — KHÔNG phải đăng nhập (ADR 15 sửa ở C-019).
 *
 * Cả nhóm ngồi chung bàn, không ai muốn tạo tài khoản để ghi điểm bài. Nhưng dữ
 * liệu giờ nằm ở server, nên phải có cách trỏ đúng "ván bài của máy này" — nếu
 * không thì ai mở URL cũng rơi vào phiên của người khác.
 *
 * Đây là cái vòng tay giữ chỗ: đủ để quay lại đúng ván khi thoát giữa chừng,
 * không mang theo danh tính gì cả. Mất nó (xoá dữ liệu trình duyệt, đổi máy) thì
 * mất đường về phiên cũ — chấp nhận được, vì cái giá của phương án kia là bắt
 * người ta đăng nhập để đếm điểm tá lả.
 */

const KEY = "game-companion:device-id:v1";

function create(): string {
  // `randomUUID` cần secure context; mở qua IP LAN thì không có, nên phải có
  // đường lùi. Không cần bảo mật ở đây — chỉ cần đừng trùng nhau.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;

  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = create();
    localStorage.setItem(KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // Chế độ riêng tư chặn localStorage: vẫn chơi được trong phiên hiện tại,
    // chỉ là đóng tab thì mất đường về. Giữ trong RAM cho đỡ đổi giữa chừng.
    cached = cached ?? create();
    return cached;
  }
}
