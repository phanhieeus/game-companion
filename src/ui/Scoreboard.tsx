import type { Scoreboard as ScoreboardData } from "../domain/types";

interface Props {
  scoreboard: ScoreboardData;
  mePlayerId?: string | undefined;
}

export function Scoreboard({ scoreboard, mePlayerId }: Props) {
  // Chưa đá ván nào thì ai cũng hạng 1 — hiện ra chỉ làm rối, giấu đi.
  const showRank = scoreboard.roundsPlayed > 0;

  return (
    <div className={`scoreboard${showRank ? "" : " no-rank"}`}>
      {scoreboard.rows.map((row) => (
        <div
          className={`row${row.rank === 1 && showRank ? " leader" : ""}`}
          key={row.playerId}
        >
          {showRank && <span className="rank">{row.rank}</span>}
          <span className="name">
            {row.name}
            {row.playerId === mePlayerId && <span className="me"> · tôi</span>}
          </span>
          <span
            className={`total${row.total > 0 ? " pos" : row.total < 0 ? " neg" : ""}`}
          >
            {row.total > 0 ? `+${row.total}` : row.total}
          </span>
        </div>
      ))}
    </div>
  );
}
