import type { Round, Session } from "../domain/types";

interface Props {
  session: Session;
  rounds: Round[];
  onUndo: (roundId: string) => void;
}

/**
 * T + C — thấy lại các ván đã ghi, và hủy được bằng nút.
 *
 * Trước đây undo chỉ làm được bằng giọng nói. Khi micro không nghe ra hoặc hết
 * quota, người dùng kẹt luôn với một ván sai trong sổ.
 */
export function History({ session, rounds, onUndo }: Props) {
  const nameOf = (playerId: string) =>
    session.players.find((p) => p.id === playerId)?.name ?? "?";

  const visible = rounds.filter((r) => r.status === "recorded").slice(0, 4);

  if (visible.length === 0) {
    return <p className="history-empty">Chưa ghi ván nào.</p>;
  }

  return (
    <div className="history">
      {visible.map((round) => (
        <div className="history-row" key={round.id}>
          <span className="hseq">#{round.sequenceNo}</span>
          <span className="hentries">
            {[...round.entries]
              .sort((a, b) => b.delta - a.delta)
              .map((e) => (
                <span className="hchip" key={e.id}>
                  {nameOf(e.playerId)}{" "}
                  <b className={e.delta > 0 ? "pos" : e.delta < 0 ? "neg" : ""}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta}
                  </b>
                </span>
              ))}
          </span>
          <button
            type="button"
            className="hundo"
            onClick={() => onUndo(round.id)}
            aria-label={`Hủy ván ${round.sequenceNo}`}
          >
            Hủy
          </button>
        </div>
      ))}
    </div>
  );
}
