import { useCallback, useState } from "react";
import type { RoundOrder } from "./RoundsTable";

export const ROUND_ORDER_KEY = "game-companion:round-order:v1";

/**
 * Thứ tự bảng là tuỳ chọn hiển thị của người cầm máy, KHÔNG phải dữ liệu ván
 * bài — nên lưu riêng ở localStorage chứ không nhét vào `Session`
 * (ADR quyết định 5). Nhét vào Session thì phải sửa type, repository, và mọi
 * test đang dựng session, chỉ để đổi một nút bấm.
 */
function read(): RoundOrder {
  try {
    const stored = localStorage.getItem(ROUND_ORDER_KEY);
    if (stored === "newest-first" || stored === "newest-last") return stored;
  } catch {
    // Chế độ riêng tư chặn localStorage — mặc định vẫn dùng được.
  }
  return "newest-last";
}

export function useRoundOrder(): [RoundOrder, () => void] {
  const [order, setOrder] = useState<RoundOrder>(read);

  const toggle = useCallback(() => {
    setOrder((current) => {
      const next: RoundOrder =
        current === "newest-last" ? "newest-first" : "newest-last";
      try {
        localStorage.setItem(ROUND_ORDER_KEY, next);
      } catch {
        // Không lưu được thì vẫn đổi trong phiên hiện tại.
      }
      return next;
    });
  }, []);

  return [order, toggle];
}
