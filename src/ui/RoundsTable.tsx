import { useEffect, useMemo, useState } from "react";
import type { Round, Scoreboard, Session } from "../domain/types";
import { wasModified } from "../domain/scoring";
import type { DraftEntry } from "../domain/scoring";

export type RoundOrder = "newest-last" | "newest-first";

/** Bản nháp một hàng đang sửa/thêm: chuỗi thô để người dùng gõ tự do. */
type Draft = Record<string, string>;

interface Props {
  session: Session;
  rounds: Round[];
  order: RoundOrder;
  scoreboard: Scoreboard;
  onUndo: (roundId: string) => void;
  /** Trả về thông báo lỗi, hoặc null nếu lưu được. */
  onSaveEdit: (roundId: string, entries: DraftEntry[]) => string | null;
  onAddRound: (entries: DraftEntry[]) => string | null;
  onShowHistory: (round: Round) => void;
}

const toDraft = (round: Round, playerIds: string[]): Draft => {
  const draft: Draft = {};
  for (const id of playerIds) {
    const delta = round.entries.find((e) => e.playerId === id)?.delta;
    draft[id] = delta === undefined ? "" : String(delta);
  }
  return draft;
};

const parseDraft = (draft: Draft): DraftEntry[] =>
  Object.entries(draft)
    .filter(([, raw]) => raw.trim() !== "")
    .map(([playerId, raw]) => ({ playerId, delta: Number(raw) }))
    .filter((e) => Number.isFinite(e.delta));

/**
 * Bảng điểm theo từng ván — mỗi hàng một ván, mỗi người một cột.
 *
 * Sửa ô ngay tại chỗ như Excel: bấm vào ô để mở hàng đó ra sửa, gõ tự do, chỉ
 * LƯU được khi tổng về 0 (ADR quyết định 7). Chặn từng phím gõ thì không sửa
 * nổi gì, vì đổi một ô là tổng lệch ngay.
 *
 * Không cuộn ngang (ADR quyết định 6): co cỡ chữ theo số người chơi.
 */
export function RoundsTable({
  session,
  rounds,
  order,
  scoreboard,
  onUndo,
  onSaveEdit,
  onAddRound,
  onShowHistory,
}: Props) {
  const players = useMemo(
    () => session.players.filter((p) => p.status === "active"),
    [session.players],
  );
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const recorded = rounds.filter((r) => r.status === "recorded");

  /** null = không sửa gì; "new" = đang thêm hàng mới; còn lại = id ván. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);

  // Đổi phiên thì bỏ mọi thứ đang sửa dở, tránh ghi nhầm sang ván khác.
  useEffect(() => {
    setEditing(null);
    setDraft({});
    setError(null);
  }, [session.id]);

  const parsed = parseDraft(draft);
  const draftSum = parsed.reduce((acc, e) => acc + e.delta, 0);

  const openEdit = (round: Round) => {
    setEditing(round.id);
    setDraft(toDraft(round, playerIds));
    setError(null);
  };

  const openAdd = () => {
    setEditing("new");
    setDraft(Object.fromEntries(playerIds.map((id) => [id, ""])));
    setError(null);
  };

  const cancel = () => {
    setEditing(null);
    setDraft({});
    setError(null);
  };

  const save = () => {
    const entries = parseDraft(draft);
    const problem =
      editing === "new" ? onAddRound(entries) : onSaveEdit(editing!, entries);
    if (problem) return setError(problem);
    cancel();
  };

  const ordered = [...recorded].sort((a, b) =>
    order === "newest-last"
      ? a.sequenceNo - b.sequenceNo
      : b.sequenceNo - a.sequenceNo,
  );

  // Ô trống là `·`, không phải `0` — "không tham gia" khác "ghi 0 điểm".
  const deltaOf = (round: Round, playerId: string): number | null =>
    round.entries.find((e) => e.playerId === playerId)?.delta ?? null;

  const totalOf = (playerId: string) =>
    recorded.reduce((sum, r) => sum + (deltaOf(r, playerId) ?? 0), 0);

  const leaderId =
    scoreboard.roundsPlayed > 0
      ? (scoreboard.rows.find((r) => r.rank === 1)?.playerId ?? null)
      : null;

  const cellClass = (delta: number | null) =>
    delta === null ? "empty" : delta > 0 ? "pos" : delta < 0 ? "neg" : "";

  /** Hàng đang sửa — ô nhập số thay cho ô chữ. */
  const editRow = (key: string, seqLabel: string) => (
    <tr className="editing" key={key}>
      <th className="c-seq" scope="row">
        {seqLabel}
      </th>
      {players.map((p) => (
        <td key={p.id}>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            placeholder="·"
            aria-label={`Điểm của ${p.name}`}
            value={draft[p.id] ?? ""}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, [p.id]: e.target.value }))
            }
          />
        </td>
      ))}
      <td className="c-act" />
    </tr>
  );

  const hasTable = recorded.length > 0 || editing === "new";

  return (
    <div className={`rounds-table cols-${players.length}`}>
      {hasTable && (
        <table>
          <thead>
            <tr>
              <th className="c-seq" scope="col">
                Ván
              </th>
              {players.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  title={p.name}
                  className={p.id === leaderId ? "leader-col" : ""}
                >
                  {p.name}
                  {p.id === session.mePlayerId && <span className="me"> ·</span>}
                </th>
              ))}
              <th className="c-act" scope="col">
                <span className="sr-only">Hủy</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {ordered.map((round) =>
              editing === round.id ? (
                editRow(round.id, String(round.sequenceNo))
              ) : (
                <tr key={round.id}>
                  <th className="c-seq" scope="row">
                    {/*
                      Ván từng bị sửa: cả ô số ván thành nút xem lịch sử.
                      Trước đây là một dấu nhỏ xíu lồng trong ô — mục tiêu chạm
                      chỉ ~10px, ngón tay không bấm trúng, và chính thẻ <th> cha
                      nuốt mất sự kiện bấm.
                    */}
                    {wasModified(round) ? (
                      <button
                        type="button"
                        className="seq-button"
                        aria-label={`Lịch sử ván ${round.sequenceNo}`}
                        onClick={() => onShowHistory(round)}
                      >
                        {round.sequenceNo}
                        <span className="ev-dot" aria-hidden="true">
                          ˟
                        </span>
                      </button>
                    ) : (
                      round.sequenceNo
                    )}
                  </th>
                  {players.map((p) => {
                    const delta = deltaOf(round, p.id);
                    return (
                      <td
                        key={p.id}
                        className={`tap ${cellClass(delta)}`}
                        onClick={() => openEdit(round)}
                        title="Bấm để sửa"
                      >
                        {delta === null ? "·" : delta > 0 ? `+${delta}` : delta}
                      </td>
                    );
                  })}
                  <td className="c-act">
                    <button
                      type="button"
                      onClick={() => onUndo(round.id)}
                      aria-label={`Hủy ván ${round.sequenceNo}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ),
            )}

            {/* Hàng thêm mới — thay hẳn cho nút "Nhập tay" trước đây. */}
            {editing === "new" && editRow("new", "+")}
          </tbody>

          {recorded.length > 0 && (
            <tfoot>
              <tr>
                <th className="c-seq" scope="row">
                  Σ
                </th>
                {players.map((p) => {
                  const total = totalOf(p.id);
                  return (
                    <td
                      key={p.id}
                      className={total > 0 ? "pos" : total < 0 ? "neg" : ""}
                    >
                      {total > 0 ? `+${total}` : total}
                    </td>
                  );
                })}
                <td className="c-act" />
              </tr>
            </tfoot>
          )}
        </table>
      )}

      {!hasTable && (
        <p className="history-empty">Chưa ghi ván nào.</p>
      )}

      {editing ? (
        <div className="edit-bar">
          <span
            className={`edit-sum ${draftSum === 0 && parsed.length > 0 && !error ? "ok" : "bad"}`}
          >
            {error ??
              (parsed.length === 0
                ? "Chưa nhập điểm cho ai"
                : draftSum === 0
                  ? "Tổng 0 ✓"
                  : `Tổng ${draftSum} — chưa cân`)}
          </span>
          <div className="edit-actions">
            <button
              type="button"
              className="save"
              disabled={draftSum !== 0 || parsed.length === 0}
              onClick={save}
            >
              Lưu
            </button>
            <button type="button" className="cancel" onClick={cancel}>
              Hủy
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="add-row" onClick={openAdd}>
          + Thêm ván
        </button>
      )}
    </div>
  );
}
