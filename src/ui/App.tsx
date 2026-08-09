import { useCallback, useEffect, useMemo, useState } from "react";
import type { Round, RoundEvent, Scoreboard, Session } from "../api/model";
import * as api from "../api/client";
import { ApiError, type SessionView } from "../api/client";
import { useConversation } from "../conversation/useConversation";
import { isSpeechRecognitionSupported } from "../voice/speech";
import { RoundsTable } from "./RoundsTable";
import { useRoundOrder } from "./roundOrder";
import { BackToTop } from "./BackToTop";
import { RoundHistory } from "./RoundHistory";
import { Chat } from "./Chat";
import { Composer } from "./Composer";
import { SetupScreen } from "./SetupScreen";

const EMPTY_SCOREBOARD: Scoreboard = { rows: [], roundsPlayed: 0 };

const RANK_WORDS = ["nhất", "nhì", "ba", "tư", "năm", "sáu", "bảy"];

/**
 * ["nhất", "nhì", "ba", "bét"] cho bàn 4 người.
 *
 * Chép lại `rank_labels` bên Python thay vì kéo qua dây: đây là CHỮ HIỆN LÊN
 * nhãn ô nhập, không phải dữ liệu — thêm một field vào response chỉ để mang mấy
 * chữ này là làm bẩn hợp đồng vì một chuyện thuần hiển thị.
 */
const rankLabels = (count: number): string[] => {
  if (count <= 0) return [];
  const labels = Array.from(
    { length: count },
    (_, i) => RANK_WORDS[i] ?? String(i + 1),
  );
  labels[count - 1] = "bét";
  return labels;
};

interface BonusDraft {
  name: string;
  points: string;
  paidBy: "each" | "split";
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard>(EMPTY_SCOREBOARD);
  // Dữ liệu nằm ở server nên có một khoảnh khắc CHƯA BIẾT — trước đây không có.
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [roundOrder, toggleRoundOrder, setRoundOrder] = useRoundOrder();
  const [historyRound, setHistoryRound] = useState<Round | null>(null);
  const [historyEvents, setHistoryEvents] = useState<RoundEvent[]>([]);
  const [undo, setUndo] = useState<{ undo: string | null; redo: string | null }>({
    undo: null,
    redo: null,
  });
  // Giới hạn số người chơi do server áp (ADR 17). Mặc định 4–5 chỉ để form vẽ
  // được trước khi /health trả lời; server mới là nơi quyết.
  const [limits, setLimits] = useState({ minPlayers: 4, maxPlayers: 5 });
  // Luật nhà đang gõ dở. Giữ dạng CHUỖI chứ không số: gõ "-" rồi mới gõ "3" là
  // chuyện bình thường, ép về số ngay thì ô nhảy lung tung dưới tay người dùng.
  const [rankDraft, setRankDraft] = useState<string[]>([]);
  const [bonusDraft, setBonusDraft] = useState<BonusDraft[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const applyView = useCallback((view: SessionView) => {
    setSession(view.session);
    setScoreboard(view.scoreboard);
  }, []);

  /** Nút hoàn tác phải biết còn gì để làm không — server mới trả lời được. */
  const refreshUndo = useCallback(async (id: string) => {
    try {
      setUndo(await api.undoState(id));
    } catch {
      setUndo({ undo: null, redo: null });
    }
  }, []);

  // Mở lại app là tiếp tục phiên đang chơi (câu hỏi mở số 4) — hỏi server.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [{ session: found, scoreboard: board }, info] = await Promise.all([
          api.activeSession(),
          api.health().catch(() => null),
        ]);
        if (!alive) return;
        if (info) setLimits({ minPlayers: info.minPlayers, maxPlayers: info.maxPlayers });
        setSession(found);
        setScoreboard(board ?? EMPTY_SCOREBOARD);
        if (found) void refreshUndo(found.id);
      } catch (err) {
        if (alive) setSetupError(err instanceof ApiError ? err.message : null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshUndo]);

  const onAgentReply = useCallback(
    (reply: { session: Session; scoreboard: Scoreboard }) => {
      applyView(reply);
      void refreshUndo(reply.session.id);
    },
    [applyView, refreshUndo],
  );

  const { view, startTurn, endTurn, cancelTurn, confirmByTap, retry, sendText } =
    useConversation(session?.id ?? null, onAgentReply, setRoundOrder);

  const history = useMemo(
    () =>
      session
        ? [...session.rounds].sort((a, b) => b.sequenceNo - a.sequenceNo)
        : [],
    [session],
  );

  const activePlayers = useMemo(
    () => (session?.players ?? []).filter((p) => p.status === "active"),
    [session],
  );

  /**
   * Bốc luật nhà từ server về các ô nhập — CHỈ khi luật hoặc số người đổi.
   *
   * Nếu nghe cả `session` thì mỗi ván ghi xong sẽ nạp lại ô đang gõ dở và xoá
   * mất chữ người dùng vừa gõ. Chữ ký dưới đây đổi đúng lúc cần đổi: đặt lại
   * luật, hoặc thêm/bớt người (lúc đó bảng hạng phải giãn ra cho khớp).
   */
  const rulesKey = session
    ? `${activePlayers.length}|${JSON.stringify(session.scoringConfig)}`
    : "";
  useEffect(() => {
    if (!session) return;
    const points = session.scoringConfig.rankPoints ?? [];
    setRankDraft(
      Array.from({ length: activePlayers.length }, (_, i) =>
        points[i] === undefined ? "" : String(points[i]),
      ),
    );
    setBonusDraft(
      (session.scoringConfig.bonuses ?? []).map((b) => ({
        name: b.name,
        points: String(b.points),
        paidBy: b.paidBy,
      })),
    );
    setRulesError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesKey]);

  // C — Esc để thoát khỏi lượt đang dở, không phải chờ nó tự xong.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelTurn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelTurn]);

  /** Mọi thao tác giờ là một chuyến đi mạng — lỗi phải về đúng chỗ gọi. */
  const run = useCallback(
    async (action: () => Promise<SessionView>): Promise<string | null> => {
      try {
        const next = await action();
        applyView(next);
        void refreshUndo(next.session.id);
        return null;
      } catch (err) {
        return err instanceof ApiError ? err.message : "Có lỗi, thử lại nhé.";
      }
    },
    [applyView, refreshUndo],
  );

  const createSession = async (players: string[], meName: string | null) => {
    try {
      applyView(await api.createSession(players, meName));
      setSetupError(null);
    } catch (err) {
      setSetupError(err instanceof ApiError ? err.message : "Không tạo được phiên.");
    }
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Đang mở phiên…</div>
      </div>
    );
  }

  if (!session || session.status === "ended") {
    return (
      <div className="app">
        {session?.status === "ended" && (
          <div className="ended-banner">Phiên trước đã kết thúc.</div>
        )}
        <SetupScreen
          onCreate={createSession}
          error={setupError}
          minPlayers={limits.minPlayers}
          maxPlayers={limits.maxPlayers}
        />
      </div>
    );
  }

  const id = session.id;
  const labels = rankLabels(activePlayers.length);
  const rankNumbers = rankDraft.map((v) => Number(v.trim()));
  const rankFilled = rankDraft.filter((v) => v.trim() !== "").length;
  const rankSum = rankNumbers.reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0);

  /**
   * Lưu luật nhà. Server mới là nơi QUYẾT — ở đây chỉ dịch ô nhập thành số.
   *
   * Xoá trắng cả hàng hạng = bỏ luật hạng (`null`), khác hẳn với `[]`. Nửa vời
   * (điền vài ô) thì chặn tại đây, vì gửi lên cũng bị từ chối mà lại tốn một
   * chuyến mạng để nghe cùng một câu.
   */
  const saveRules = async () => {
    const cleared = rankFilled === 0;
    if (!cleared && rankFilled !== rankDraft.length) {
      setRulesError(`Điền đủ ${rankDraft.length} mức, từ nhất xuống bét.`);
      return;
    }
    if (!cleared && rankNumbers.some((n) => !Number.isInteger(n))) {
      setRulesError("Mỗi mức phải là một số nguyên.");
      return;
    }

    const bonuses = bonusDraft
      .filter((b) => b.name.trim() !== "")
      .map((b) => ({
        name: b.name.trim(),
        points: Number(b.points.trim()) || 0,
        paidBy: b.paidBy,
      }));

    setRulesError(
      await run(() =>
        api.setScoringConfig(id, {
          rankPoints: cleared ? null : rankNumbers,
          bonuses,
        }),
      ),
    );
  };

  const setBonus = (index: number, patch: Partial<BonusDraft>) =>
    setBonusDraft((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );

  const busy = view.state === "understanding";
  const canSpeak = isSpeechRecognitionSupported();
  const listening = view.state === "listening";

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Ghi điểm</h1>
          <div className="meta">
            {scoreboard.roundsPlayed} ván · tổng mỗi ván = 0
            {/* T — agent nghĩ mấy bước cho câu vừa rồi. Mỗi bước là một lượt
                gọi Gemini, nên đây cũng là con số cho biết quota đi đâu. */}
            {view.steps > 1 && ` · ${view.steps} bước`}
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setShowSettings((s) => !s)}
        >
          {showSettings ? "Đóng" : "Cài đặt"}
        </button>
      </header>

      {showSettings && (
        <div className="settings">
          <div className="settings-row">
            <span>Xác nhận trước khi ghi</span>
            <button
              type="button"
              className="icon-button"
              onClick={() =>
                void run(() =>
                  api.setConfirmBeforeCommit(id, !session.confirmBeforeCommit),
                )
              }
            >
              {session.confirmBeforeCommit ? "Đang bật" : "Đang tắt"}
            </button>
          </div>
          {/* Luật nhà: nhất nhì ba bét mỗi hạng một mức, thưởng là khoản cộng
              thêm. Đặt ở đây hoặc nói ra miệng đều đi chung một cửa
              (`update_scoring_config`), nên không có luật nào lọt được vào
              bằng đường này mà đường kia chặn. */}
          <div className="rules">
            <div className="rules-head">
              <span>Điểm theo thứ hạng</span>
              {/* T — tổng hiện ngay dưới tay, không phải bấm Lưu mới biết sai.
                  zeroSum vẫn là cổng cuối, ở đây chỉ nói trước cho đỡ mất công. */}
              <span className={`rules-sum ${rankSum === 0 ? "" : "bad"}`}>
                {rankFilled === 0
                  ? "chưa đặt"
                  : rankSum === 0
                    ? "tổng 0 — cân"
                    : `tổng ${rankSum} — không cân`}
              </span>
            </div>

            <div className="rank-grid">
              {rankDraft.map((value, index) => (
                <label className="rank-cell" key={index}>
                  <span>{labels[index]}</span>
                  <input
                    value={value}
                    inputMode="numeric"
                    aria-label={`Điểm hạng ${labels[index]}`}
                    onChange={(e) =>
                      setRankDraft((prev) =>
                        prev.map((v, i) => (i === index ? e.target.value : v)),
                      )
                    }
                  />
                </label>
              ))}
            </div>

            <div className="rules-head">
              <span>Thưởng</span>
            </div>

            {bonusDraft.map((bonus, index) => (
              <div className="bonus-row" key={index}>
                <input
                  value={bonus.name}
                  placeholder="tứ quý"
                  aria-label={`Tên thưởng ${index + 1}`}
                  onChange={(e) => setBonus(index, { name: e.target.value })}
                />
                <input
                  value={bonus.points}
                  inputMode="numeric"
                  className="bonus-points"
                  aria-label={`Điểm thưởng ${index + 1}`}
                  onChange={(e) => setBonus(index, { points: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Cách chung thưởng ${index + 1}`}
                  title={
                    bonus.paidBy === "each"
                      ? "Mỗi người còn lại chung đủ chừng đó"
                      : "Những người còn lại chia đều chừng đó"
                  }
                  onClick={() =>
                    setBonus(index, {
                      paidBy: bonus.paidBy === "each" ? "split" : "each",
                    })
                  }
                >
                  {bonus.paidBy === "each" ? "mỗi người" : "chia đều"}
                </button>
                <button
                  type="button"
                  className="remove"
                  aria-label={`Xoá thưởng ${index + 1}`}
                  onClick={() =>
                    setBonusDraft((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  ✕
                </button>
              </div>
            ))}

            <button
              type="button"
              className="ghost"
              onClick={() =>
                setBonusDraft((prev) => [
                  ...prev,
                  { name: "", points: "0", paidBy: "each" },
                ])
              }
            >
              + Thêm thưởng
            </button>

            {rulesError && <div className="warning">{rulesError}</div>}

            <button type="button" className="primary" onClick={() => void saveRules()}>
              Lưu luật nhà
            </button>
          </div>

          <button
            type="button"
            className="ghost"
            onClick={() => void run(() => api.endSession(id))}
          >
            Kết thúc phiên
          </button>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Điểm từng ván</h2>
          <div className="panel-tools">
            <button
              type="button"
              className="tool-btn"
              onClick={() => void run(() => api.undoLast(id))}
              disabled={!undo.undo}
              aria-label={undo.undo ?? "Không còn gì để hoàn tác"}
              title={undo.undo ?? "Không còn gì để hoàn tác"}
            >
              ↶
            </button>
            <button
              type="button"
              className="tool-btn"
              onClick={() => void run(() => api.redoLast(id))}
              disabled={!undo.redo}
              aria-label={undo.redo ?? "Không còn gì để làm lại"}
              title={undo.redo ?? "Không còn gì để làm lại"}
            >
              ↷
            </button>
            <button
              type="button"
              className="tool-btn wide"
              onClick={toggleRoundOrder}
              aria-label="Đổi thứ tự ván"
            >
              {roundOrder === "newest-last" ? "Mới ↓" : "Mới ↑"}
            </button>
          </div>
        </div>
        <RoundsTable
          session={session}
          rounds={history}
          order={roundOrder}
          scoreboard={scoreboard}
          onUndo={(roundId) => void run(() => api.deleteRound(id, roundId))}
          onSaveEdit={(roundId, entries) =>
            run(() => api.updateRound(id, roundId, entries))
          }
          onAddRound={(entries) => run(() => api.recordRound(id, entries))}
          onShowHistory={async (round) => {
            setHistoryRound(round);
            try {
              setHistoryEvents((await api.roundEvents(id, round.id)).events);
            } catch {
              setHistoryEvents([]);
            }
          }}
        />
      </section>

      <div className="spacer" />

      {/* Khối hội thoại DÍNH ĐÁY màn hình, không trôi theo trang.

          Thẻ đề xuất nằm trong mạch chat (C-024) — nhưng nếu cả mạch cuộn theo
          trang thì chơi 16 ván xong, nút Ghi bị đẩy khỏi màn hình và phải cuộn
          xuống mới chốt được ván. C-003 đã chốt điều ngược lại (metric PRD #3).
          Neo cả khối xuống đáy giữ được cả hai: đề xuất ở trong mạch, mà vẫn
          luôn trong tầm tay. */}
      <div className="dock">
        {/* T — cả mạch hội thoại, không chỉ câu cuối. */}
        <Chat
          messages={view.messages}
          state={view.state}
          transcript={view.transcript}
          pendingPrompt={view.pendingPrompt}
          proposal={view.proposal}
          canRetry={view.canRetry}
          onRetry={retry}
          onAccept={() => void confirmByTap(true)}
          onReject={() => void confirmByTap(false)}
        />

        <Composer
          busy={busy}
          listening={listening}
          canSpeak={canSpeak}
          onSend={sendText}
          onStart={startTurn}
          onEnd={endTurn}
          onCancel={cancelTurn}
        />
      </div>

      <BackToTop />

      {historyRound && (
        <RoundHistory
          sequenceNo={historyRound.sequenceNo}
          events={historyEvents}
          players={session.players}
          onClose={() => setHistoryRound(null)}
        />
      )}
    </div>
  );
}
