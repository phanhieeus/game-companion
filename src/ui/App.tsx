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
import { ProposalCard } from "./ProposalCard";
import { SetupScreen } from "./SetupScreen";

/** T — trạng thái phải đọc được từ xa, không phải dòng chữ xám bé tí. */
const STATE_LABEL: Record<string, string> = {
  idle: "",
  listening: "Đang nghe…",
  understanding: "Đang nghĩ…",
  confirming: "Kiểm lại rồi bấm Ghi",
};

const EMPTY_SCOREBOARD: Scoreboard = { rows: [], roundsPlayed: 0 };

/** Câu cuối của một đoạn — phần hỏi, bỏ phần liệt kê số ở trước. */
function lastSentence(text: string | null): string | null {
  if (!text) return null;
  const parts = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  return parts.at(-1) ?? text;
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

  const { view, startTurn, endTurn, cancelTurn, confirmByTap, retry } =
    useConversation(session?.id ?? null, onAgentReply, setRoundOrder);

  const history = useMemo(
    () =>
      session
        ? [...session.rounds].sort((a, b) => b.sequenceNo - a.sequenceNo)
        : [],
    [session],
  );

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

      {/* T — câu vừa nói và câu agent trả lời, tách bạch rõ. */}
      <div className="transcript">
        {view.transcript ? (
          <p className={`you${listening ? " live" : ""}`}>{view.transcript}</p>
        ) : (
          !view.agentSays &&
          !view.error && (
            <p className="hint">
              Nhấn giữ nút bên dưới rồi nói, ví dụ “Nam ăn 3, ba người kia mỗi
              người chung 1”.
            </p>
          )
        )}

        {view.error ? (
          <p className="error">{view.error}</p>
        ) : (
          view.agentSays &&
          view.state !== "confirming" && <p className="agent">{view.agentSays}</p>
        )}

        {/* R — chạy lại đúng câu vừa nói, không bắt nói lại. */}
        {view.canRetry && (
          <button type="button" className="retry" onClick={retry}>
            ↻ Thử lại câu vừa nói
          </button>
        )}
      </div>

      {/* Thẻ xác nhận nằm TRONG khối dính đáy màn hình cùng nút Voice.
          Để ngoài thì thanh dính đè lên nút Ghi — nút quan trọng nhất bị che. */}
      <div className="voice-area">
        {view.state === "confirming" &&
          (view.proposal ? (
            <ProposalCard
              rows={view.proposal}
              /* Câu của tool ("Lan +4, Hùng −1… Ghi ván này nhé?") viết ra để
                 ĐỌC LÊN — nghe thì cần con số. Trên màn hình thì các dòng bên
                 dưới đã có đủ, nhắc lại thành chữ chỉ làm rối chỗ cần liếc
                 nhanh nhất. Lấy đúng câu hỏi ở cuối làm tiêu đề. */
              title={lastSentence(view.pendingPrompt) ?? "Ghi ván này nhé?"}
              onAccept={() => void confirmByTap(true)}
              onReject={() => void confirmByTap(false)}
            />
          ) : (
            /* Tool không có con số nào để vẽ ("kết thúc phiên nhé?") — vẫn phải
               có hai nút, nếu không thì người dùng kẹt ở trạng thái chờ chốt mà
               không bấm được gì ngoài nói tiếp. */
            <div className="proposal" role="group" aria-label="Xác nhận">
              <div className="proposal-head">{view.pendingPrompt}</div>
              <div className="confirm-bar">
                <button
                  type="button"
                  className="yes"
                  onClick={() => void confirmByTap(true)}
                >
                  Đồng ý
                </button>
                <button
                  type="button"
                  className="no"
                  onClick={() => void confirmByTap(false)}
                >
                  Bỏ qua
                </button>
              </div>
            </div>
          ))}

        {view.state !== "confirming" && (
          <span className={`voice-state${listening ? " live" : ""}`}>
            {STATE_LABEL[view.state]}
          </span>
        )}

        <button
          type="button"
          className={`voice-button${listening ? " active" : ""}`}
          disabled={busy || !canSpeak}
          // Nhấn giữ để nói, nhả tay là dừng — không nghe liên tục.
          onPointerDown={startTurn}
          onPointerUp={endTurn}
          onPointerLeave={() => listening && cancelTurn()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {listening
            ? "Đang nghe — nhả tay để dừng"
            : canSpeak
              ? "Nhấn giữ để nói"
              : "Trình duyệt không hỗ trợ giọng nói"}
        </button>
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
