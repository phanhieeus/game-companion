import { useCallback, useMemo, useState } from "react";
import { computeScoreboard } from "../domain/scoring";
import type { Session } from "../domain/types";
import { LocalStorageSessionRepository } from "../repository/localStorageRepository";
import { createTools } from "../tools";
import { useConversation } from "../conversation/useConversation";
import { isSpeechRecognitionSupported } from "../voice/speech";
import { Scoreboard } from "./Scoreboard";
import { SetupScreen } from "./SetupScreen";

const repo = new LocalStorageSessionRepository();
const tools = createTools(repo);

const STATE_LABEL: Record<string, string> = {
  idle: "",
  listening: "Đang nghe…",
  understanding: "Đang hiểu…",
  clarifying: "Đang chờ bạn trả lời",
  confirming: "Đang chờ xác nhận",
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

  const { view, startTurn, endTurn, cancelTurn, confirmByTap } = useConversation(
    session,
    tools,
    refresh,
  );

  const scoreboard = useMemo(
    () =>
      session ? computeScoreboard(session) : { rows: [], roundsPlayed: 0 },
    [session],
  );

  const createSession = (players: string[], meName: string | null) => {
    const result = tools.create_session({
      players: players.map((name) => ({ name })),
      ...(meName ? { me_player_name: meName } : {}),
    });
    if (!result.ok) return setSetupError(result.error.message);
    setSetupError(null);
    setSession(repo.get(result.data.session_id) ?? null);
  };

  if (!session || session.status === "ended") {
    return (
      <div className="app">
        {session?.status === "ended" && (
          <div className="transcript">
            <span className="agent">
              Phiên trước đã kết thúc. {view.agentSays}
            </span>
          </div>
        )}
        <SetupScreen onCreate={createSession} error={setupError} />
      </div>
    );
  }

  const busy = view.state !== "idle" && view.state !== "confirming";
  const canSpeak = isSpeechRecognitionSupported();

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Ghi điểm</h1>
          <div className="meta">
            {scoreboard.roundsPlayed} ván · tổng mỗi ván = 0
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setShowSettings((s) => !s)}
        >
          Cài đặt
        </button>
      </header>

      {showSettings && (
        <>
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
        </>
      )}

      <Scoreboard scoreboard={scoreboard} mePlayerId={session.mePlayerId} />

      <div className="transcript">
        {view.transcript && <span className="you">Bạn: {view.transcript}</span>}
        {view.error ? (
          <span className="error">{view.error}</span>
        ) : (
          view.agentSays && <span className="agent">{view.agentSays}</span>
        )}
        {!view.transcript && !view.agentSays && !view.error && (
          <span className="you">
            Nhấn giữ nút bên dưới rồi nói, ví dụ "Nam ăn 3, ba người kia mỗi
            người chung 1".
          </span>
        )}
      </div>

      <div className="spacer" />

      <div className="voice-area">
        <span className="voice-state">{STATE_LABEL[view.state]}</span>

        {view.state === "confirming" ? (
          <div className="confirm-bar">
            <button
              type="button"
              className="yes"
              onClick={() => confirmByTap(true)}
            >
              Ghi
            </button>
            <button
              type="button"
              className="no"
              onClick={() => confirmByTap(false)}
            >
              Bỏ qua
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className={`voice-button${view.state === "listening" ? " active" : ""}`}
          disabled={busy || !canSpeak}
          // Nhấn giữ để nói, nhả tay là dừng — không nghe liên tục.
          onPointerDown={startTurn}
          onPointerUp={endTurn}
          onPointerLeave={() => view.state === "listening" && cancelTurn()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {view.state === "listening"
            ? "Đang nghe — nhả tay để dừng"
            : canSpeak
              ? "Nhấn giữ để nói"
              : "Trình duyệt không hỗ trợ giọng nói"}
        </button>
      </div>
    </div>
  );
}
