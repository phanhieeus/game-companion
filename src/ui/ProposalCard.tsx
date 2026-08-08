import type { ProposalRow } from "../api/model";

interface Props {
  rows: ProposalRow[];
  title: string;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * T — hiện con số agent định ghi, không chỉ đọc lên.
 *
 * Nghe "Hùng trừ một" giữa lúc ồn ào rất dễ trôi; nhìn thấy "Hùng −1" thì sai
 * là phát hiện ngay. Đây là bước chốt chặn cuối trước khi điểm vào sổ.
 */
export function ProposalCard({ rows, title, onAccept, onReject }: Props) {
  const sum = rows.reduce((acc, r) => acc + r.delta, 0);

  return (
    <div className="proposal" role="group" aria-label="Xác nhận ghi điểm">
      {/* Tiêu đề ngắn thôi — con số đã nằm ở các dòng bên dưới, nhắc lại
          bằng chữ chỉ làm rối chỗ cần nhìn nhanh nhất. */}
      <div className="proposal-head">{title}</div>

      <div className="proposal-rows">
        {[...rows]
          .sort((a, b) => b.delta - a.delta)
          .map((row) => (
            <div className="proposal-row" key={row.playerId}>
              <span className="pname">{row.name}</span>
              <span
                className={`pdelta ${row.delta > 0 ? "pos" : row.delta < 0 ? "neg" : ""}`}
              >
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            </div>
          ))}
      </div>

      {/* Tổng phải bằng 0; hiện ra để người dùng tự kiểm được. */}
      <div className={`proposal-sum ${sum === 0 ? "ok" : "bad"}`}>
        Tổng {sum === 0 ? "0 ✓" : `${sum} — không cân, kiểm tra lại`}
      </div>

      <div className="confirm-bar">
        <button type="button" className="yes" onClick={onAccept}>
          Ghi
        </button>
        <button type="button" className="no" onClick={onReject}>
          Bỏ qua
        </button>
      </div>
    </div>
  );
}
