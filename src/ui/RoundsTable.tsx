import type { Round, Scoreboard, Session } from "../domain/types";

export type RoundOrder = "newest-last" | "newest-first";

interface Props {
  session: Session;
  rounds: Round[];
  order: RoundOrder;
  onUndo: (roundId: string) => void;
  /**
   * C-005: bảng xếp hạng riêng ở đầu trang đã bị bỏ (tổng hiện hai chỗ là
   * thừa). Hạng và thứ tự dồn vào chân bảng này, nên cần scoreboard để lấy.
   */
  scoreboard: Scoreboard;
}

/**
 * Bảng điểm theo từng ván — mỗi hàng một ván, mỗi người một cột.
 *
 * Lý do tồn tại (stage 01, complaint #2): app chỉ giữ điểm TỔNG mà không tra
 * được từng ván là "deal-breaker" — người ta bỏ app vì thiếu đúng cái này.
 * Có bảng thì tranh cãi "ván 3 tao có mất 2 điểm đâu" chỉ vào hàng là xong.
 *
 * Không cuộn ngang (ADR quyết định 6): co cỡ chữ theo số người chơi. Cuộn ngang
 * giữa ván bài thì người cột cuối bị khuất — đúng người hay bị quên nhất.
 */
export function RoundsTable({
  session,
  rounds,
  order,
  onUndo,
  scoreboard,
}: Props) {
  const players = session.players.filter((p) => p.status === "active");
  const recorded = rounds.filter((r) => r.status === "recorded");

  if (recorded.length === 0) {
    return <p className="history-empty">Chưa ghi ván nào.</p>;
  }

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

  return (
    <div className={`rounds-table cols-${players.length}`}>
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
          {ordered.map((round) => (
            <tr key={round.id}>
              <th className="c-seq" scope="row">
                {round.sequenceNo}
              </th>
              {players.map((p) => {
                const delta = deltaOf(round, p.id);
                return (
                  <td
                    key={p.id}
                    className={
                      delta === null
                        ? "empty"
                        : delta > 0
                          ? "pos"
                          : delta < 0
                            ? "neg"
                            : ""
                    }
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
          ))}
        </tbody>

        {/* Tổng ở chân bảng để đối chiếu ngay với bảng xếp hạng phía trên. */}
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
      </table>
    </div>
  );
}
