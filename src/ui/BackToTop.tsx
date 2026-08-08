import { useEffect, useState } from "react";

/**
 * Nút về đầu TRANG (không phải đầu trận).
 *
 * Chơi 20+ ván thì bảng dài, cuộn tay lên xem bảng xếp hạng mất thời gian giữa
 * ván bài. Chỉ hiện khi đã cuộn đủ xa để nút có ích — hiện lúc nào cũng thì nó
 * chỉ che mất nội dung.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 240);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="back-to-top"
      aria-label="Về đầu trang"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      ↑
    </button>
  );
}
