import { useCallback, useEffect, useMemo, useState } from "react";
import { computeScoreboard } from "../domain/scoring";
import type { Session } from "../domain/types";
import { LocalStorageSessionRepository } from "../repository/localStorageRepository";
import { createTools } from "../tools";
import { useConversation } from "../conversation/useConversation";
import { isSpeechRecognitionSupported } from "../voice/speech";
import { RoundsTable } from "./RoundsTable";
import { ProposalCard } from "./ProposalCard";
import { Scoreboard } from "./Scoreboard";
import { SetupScreen } from "./SetupScreen";

const repo = new LocalStorageSessionRepository();
const tools = createTools(repo);

/** T — trạng thái phải đọc được từ xa, không phải dòng chữ xám bé tí. */
const STATE_LABEL: Record<string, string> = {
  idle: "",
  listening: "Đang nghe…",
  understanding: "Đang hiểu…",
  clarifying: "Đang chờ bạn trả lời",
  confirming: "Kiểm lại rồi bấm Ghi",
  executing: "Đang ghi…",
};

export function App() {
  // Mở lại app là tiếp tục phiên đang chơi (câu hỏi mở số 4).
  const [session, setSession] = useState<Session | null>(
    () => repo.activeSession() ?? null,
  );
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(() => {
    if (!session) return;
    setSession(repo.get(session.id) ?? null);
  }, [session]);

  const { view, startTurn, endTurn, cancelTurn, confirmByTap, retry } =
    useConversation(session, tools, refresh);

  const scoreboard = useMemo(
    () => (session ? computeScoreboard(session) : { rows: [], roundsPlayed: 0 }),
    [session],
  );

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

  const createSession = (players: string[], meName: string | null) => {
    const result = tools.create_session({
      players: players.map((name) => ({ name })),
      ...(meName ? { me_player_name: meName } : {}),
    });
    if (!result.ok) return setSetupError(result.error.message);
    setSetupError(null);
    setSession(repo.get(result.data.session_id) ?? null);
  };

  const undoRound = (roundId: string) => {
    if (!session) return;
    tools.undo_round({ session_id: session.id, round_id: roundId });
    refresh();
  };

  if (!session || session.status === "ended") {
    return (
      <div className="app">
        {session?.status === "ended" && (
          <div className="ended-banner">Phiên trước đã kết thúc.</div>
        )}
        <SetupScreen onCreate={createSession} error={setupError} />
      </div>
    );
  }

  const busy = view.state !== "idle" && view.state !== "confirming";
  const canSpeak = isSpeechRecognitionSupported();
  const listening = view.state === "listening";

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Ghi điểm</h1>
          <div className="meta">
            {scoreboard.roundsPlayed} ván · tổng mỗi ván = 0
            {view.lastMs !== null && ` · ${view.lastMs}ms`}
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
              onClick={() => {
                tools.set_confirm_before_commit({
                  session_id: session.id,
                  enabled: !session.confirmBeforeCommit,
                });
                refresh();
              }}
            >
              {session.confirmBeforeCommit ? "Đang bật" : "Đang tắt"}
            </button>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              tools.end_session({ session_id: session.id });
              refresh();
            }}
          >
            Kết thúc phiên
          </button>
        </div>
      )}

      <Scoreboard scoreboard={scoreboard} mePlayerId={session.mePlayerId} />

      <section className="panel">
        <h2 className="panel-title">Điểm từng ván</h2>
        <RoundsTable
          session={session}
          rounds={history}
          order="newest-last"
          onUndo={undoRound}
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
        {view.state === "confirming" && view.proposal && (
          <ProposalCard
            rows={view.proposal}
            title={
              view.proposal.some((r) => r.delta !== 0) &&
              view.pendingPrompt?.startsWith("Hủy")
                ? view.pendingPrompt
                : "Ghi ván này nhé?"
            }
            onAccept={() => confirmByTap(true)}
            onReject={() => confirmByTap(false)}
          />
        )}

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
    </div>
  );
}
