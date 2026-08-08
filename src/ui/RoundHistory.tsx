import type { Player, RoundEvent } from "../api/model";

interface Props {
  sequenceNo: number;
  events: RoundEvent[];
  players: Player[];
  onClose: () => void;
}

const KIND_LABEL: Record<RoundEvent["kind"], string> = {
  created: "Ghi",
  updated: "Sửa",
  voided: "Hủy",
  restored: "Khôi phục",
};

const SOURCE_LABEL: Record<RoundEvent["source"], string> = {
  voice: "giọng nói",
  manual: "nhập tay",
};

/**
 * Nhật ký thay đổi của một ván (ADR quyết định 8).
 *
 * Cho sửa ô trực tiếp mà không truy được ai sửa gì lúc nào thì mất luôn khả năng
 * giải quyết tranh cãi — đúng lý do bảng theo ván tồn tại. Popup này là chỗ trả
 * lời câu "ván 3 sao khác lúc nãy".
 */
export function RoundHistory({ sequenceNo, events, players, onClose }: Props) {
  const nameOf = (playerId: string) =>
    players.find((p) => p.id === playerId)?.name ?? "?";

  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  /** Chỉ liệt kê những người THỰC SỰ đổi điểm — phần còn lại là nhiễu. */
  const changed = (event: RoundEvent) => {
    const before = new Map(event.before?.map((e) => [e.playerId, e.delta]));
    const after = new Map(event.after?.map((e) => [e.playerId, e.delta]));
    const ids = new Set([...before.keys(), ...after.keys()]);
    return [...ids]
      .map((id) => ({ id, from: before.get(id), to: after.get(id) }))
      .filter((c) => c.from !== c.to);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label={`Lịch sử ván ${sequenceNo}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <strong>Lịch sử ván {sequenceNo}</strong>
          <button type="button" className="icon-button" onClick={onClose}>
            Đóng
          </button>
        </div>

        {events.length === 0 ? (
          <p className="sheet-empty">
            Ván này ghi từ trước khi app lưu lịch sử, nên không có dữ liệu.
          </p>
        ) : (
          <ol className="sheet-list">
            {events.map((event) => (
              <li key={event.id}>
                <div className="ev-head">
                  <span className={`ev-kind k-${event.kind}`}>
                    {KIND_LABEL[event.kind]}
                  </span>
                  <span className="ev-meta">
                    {SOURCE_LABEL[event.source]} ·{" "}
                    {new Date(event.at).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <div className="ev-changes">
                  {changed(event).map((c) => (
                    <span className="ev-change" key={c.id}>
                      {nameOf(c.id)}{" "}
                      {c.from === undefined ? (
                        <b>{signed(c.to!)}</b>
                      ) : c.to === undefined ? (
                        <s>{signed(c.from)}</s>
                      ) : (
                        <>
                          <s>{signed(c.from)}</s> <b>{signed(c.to)}</b>
                        </>
                      )}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
