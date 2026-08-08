import { useMemo, useState } from "react";
import type { Session } from "../domain/types";
import type { DraftEntry } from "../domain/scoring";
import { validateRoundEntries } from "../domain/scoring";

interface Props {
  session: Session;
  onSubmit: (entries: DraftEntry[]) => void;
  onCancel: () => void;
}

/**
 * Đường lui khi giọng nói không dùng được.
 *
 * Hai cách hỏng đã xảy ra thật: quota Gemini hết giữa phiên, và Chrome chặn
 * micro trên origin không an toàn. Cả hai đều làm app vô dụng ngay giữa ván bài.
 * Kênh người dùng duy nhất là chính cái bàn đó (stage 01) — mất một lần là mất
 * luôn, không có người mới bù vào.
 *
 * Ghi qua đúng `record_round` như ván nói bằng giọng (ADR quyết định 4): dùng
 * chung validate zero-sum, idempotency, undo, lịch sử. KHÔNG tạo đường ghi
 * điểm thứ hai bỏ qua validate.
 */
export function ManualEntry({ session, onSubmit, onCancel }: Props) {
  const players = session.players.filter((p) => p.status === "active");
  const [raw, setRaw] = useState<Record<string, string>>({});

  const entries = useMemo<DraftEntry[]>(
    () =>
      players
        .map((p) => ({ playerId: p.id, delta: Number(raw[p.id] ?? "") }))
        .filter((e) => Number.isFinite(e.delta) && (raw[e.playerId] ?? "") !== ""),
    [players, raw],
  );

  const sum = entries.reduce((acc, e) => acc + e.delta, 0);

  // Validate bằng chính hàm domain — cùng luật với ván nói bằng giọng.
  const check = useMemo(
    () =>
      entries.length === 0
        ? null
        : validateRoundEntries(session, entries),
    [session, entries],
  );

  const canSubmit = check?.ok === true;

  return (
    <div className="manual" role="group" aria-label="Nhập điểm bằng tay">
      <div className="manual-head">
        <strong>Nhập tay</strong>
        <span className="manual-hint">Bỏ trống nếu người đó không có điểm</span>
      </div>

      <div className="manual-rows">
        {players.map((p) => (
          <label className="manual-row" key={p.id}>
            <span className="mname">{p.name}</span>
            <input
              type="number"
              inputMode="numeric"
              // Cho gõ cả dấu trừ; nhiều bàn phím số không có sẵn.
              step="1"
              placeholder="0"
              value={raw[p.id] ?? ""}
              aria-label={`Điểm của ${p.name}`}
              onChange={(e) =>
                setRaw((prev) => ({ ...prev, [p.id]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>

      <div className={`manual-sum ${canSubmit ? "ok" : "bad"}`}>
        {entries.length === 0
          ? "Chưa nhập điểm cho ai"
          : canSubmit
            ? `Tổng ${sum} ✓`
            : (check?.error?.message ?? `Tổng ${sum}`)}
      </div>

      <div className="confirm-bar">
        <button
          type="button"
          className="yes"
          disabled={!canSubmit}
          onClick={() => onSubmit(entries)}
        >
          Ghi
        </button>
        <button type="button" className="no" onClick={onCancel}>
          Hủy
        </button>
      </div>
    </div>
  );
}
