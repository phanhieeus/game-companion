/**
 * State machine một lượt nói — xem docs/product/voice-pipeline.md.
 *
 * Idle → Listening → Understanding → [Clarifying] → [Confirming] → Executing
 *      → Responding → Idle
 *
 * Bất biến: mọi hành động THAY ĐỔI ĐIỂM đều đi qua Confirming (trừ khi người
 * dùng tự tắt trong cài đặt). Tra cứu thì trả lời thẳng.
 * Lỗi ở bất kỳ đâu → không ghi gì, quay về Idle.
 */

import { useCallback, useRef, useState } from "react";
import type { Session } from "../domain/types";
import type { Tools } from "../tools";
import { validateRoundEntries, type DraftEntry } from "../domain/scoring";
import { buildContext, interpret } from "../nlu/interpret";
import type { Intent } from "../nlu/types";
import { startListening, speak, stopSpeaking, type Listener } from "../voice/speech";
import {
  confirmRoundPrompt,
  describeHistory,
  describePlayerScore,
  describeRoundRecorded,
  describeRoundVoided,
  describeScoreboard,
  readConfirmation,
} from "./phrases";

export type VoiceState =
  | "idle"
  | "listening"
  | "understanding"
  | "clarifying"
  | "confirming"
  | "executing";

/** Hành động đang chờ xác nhận. */
type PendingAction =
  | { kind: "record"; entries: DraftEntry[]; requestId: string }
  | { kind: "undo"; roundId?: string };

export interface ConversationView {
  state: VoiceState;
  transcript: string;
  agentSays: string;
  pendingPrompt: string | null;
  error: string | null;
}

export function useConversation(
  session: Session | null,
  tools: Tools,
  onSessionChanged: () => void,
) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [agentSays, setAgentSays] = useState("");
  const [error, setError] = useState<string | null>(null);

  const listenerRef = useRef<Listener | null>(null);
  const pendingRef = useRef<PendingAction | null>(null);
  const questionRef = useRef<string | null>(null);

  const respond = useCallback((text: string) => {
    setAgentSays(text);
    speak(text);
    setState("idle");
  }, []);

  const fail = useCallback((message: string) => {
    // Một lượt hỏng phải để lại state y như trước khi nói.
    pendingRef.current = null;
    questionRef.current = null;
    setError(message);
    setAgentSays(message);
    speak(message);
    setState("idle");
  }, []);

  const nameOf = useCallback(
    (playerId: string) =>
      session?.players.find((p) => p.id === playerId)?.name ?? "ai đó",
    [session],
  );

  /** Thực thi hành động đã được đồng ý (hoặc không cần hỏi). */
  const execute = useCallback(
    (action: PendingAction) => {
      if (!session) return;
      setState("executing");

      if (action.kind === "record") {
        const result = tools.record_round({
          session_id: session.id,
          entries: action.entries,
          client_request_id: action.requestId,
          source: "voice",
        });
        if (!result.ok) return fail(result.error.message);

        onSessionChanged();
        const round = tools
          .get_history({ session_id: session.id, limit: 1 })
          .data?.rounds[0];
        return respond(
          describeRoundRecorded(round?.sequenceNo ?? 0, result.data.scoreboard),
        );
      }

      const result = tools.undo_round({
        session_id: session.id,
        ...(action.roundId ? { round_id: action.roundId } : {}),
      });
      if (!result.ok) return fail(result.error.message);

      onSessionChanged();
      const voided = tools
        .get_history({ session_id: session.id })
        .data?.rounds.find((r) => r.id === result.data.voided_round_id);
      return respond(
        describeRoundVoided(voided?.sequenceNo ?? 0, result.data.scoreboard),
      );
    },
    [session, tools, onSessionChanged, respond, fail],
  );

  /** Xin xác nhận, hoặc chạy thẳng nếu người dùng đã tắt xác nhận. */
  const proposeOrExecute = useCallback(
    (action: PendingAction, prompt: string) => {
      if (!session?.confirmBeforeCommit) return execute(action);
      pendingRef.current = action;
      setAgentSays(prompt);
      speak(prompt);
      setState("confirming");
    },
    [session, execute],
  );

  const handleIntent = useCallback(
    (parsed: Intent) => {
      if (!session) return;

      switch (parsed.intent) {
        case "record_round": {
          const entries: DraftEntry[] = parsed.args.entries.map((e) => ({
            playerId: e.player_id,
            delta: e.delta,
          }));
          // Validate trước khi đọc lại, để không xác nhận một ván sai luật.
          // Dùng hàm thuần từ domain — không ghi gì, không đụng lịch sử.
          const check = validateRoundEntries(session, entries);
          if (!check.ok) return fail(check.error.message);

          return proposeOrExecute(
            { kind: "record", entries, requestId: `voice-${Date.now()}` },
            confirmRoundPrompt(
              entries.map((e) => ({ name: nameOf(e.playerId), delta: e.delta })),
            ),
          );
        }

        case "undo_round": {
          const history = tools.get_history({ session_id: session.id }).data;
          const target = parsed.args.sequence_no
            ? history?.rounds.find(
                (r) =>
                  r.sequenceNo === parsed.args.sequence_no &&
                  r.status === "recorded",
              )
            : history?.rounds.find((r) => r.status === "recorded");

          if (!target) return fail("Không còn ván nào để hủy.");
          return proposeOrExecute(
            { kind: "undo", roundId: target.id },
            `Hủy ván ${target.sequenceNo} nhé?`,
          );
        }

        case "query_scoreboard": {
          const board = tools.get_scoreboard({ session_id: session.id });
          if (!board.ok) return fail(board.error.message);
          return respond(describeScoreboard(board.data));
        }

        case "query_player": {
          const score = tools.get_player_score({
            session_id: session.id,
            player_id: parsed.args.player_id,
          });
          if (!score.ok) return fail(score.error.message);
          return respond(
            describePlayerScore(
              score.data.name,
              score.data.total,
              score.data.rank,
              parsed.args.player_id === session.mePlayerId,
            ),
          );
        }

        case "query_history": {
          const history = tools.get_history({
            session_id: session.id,
            limit: parsed.args.limit ?? 3,
          });
          if (!history.ok) return fail(history.error.message);
          return respond(
            describeHistory(
              history.data.rounds
                .filter((r) => r.status === "recorded")
                .map((r) => ({
                  sequenceNo: r.sequenceNo,
                  entries: r.entries.map((e) => ({
                    name: nameOf(e.playerId),
                    delta: e.delta,
                  })),
                })),
            ),
          );
        }

        case "add_player": {
          const added = tools.add_player({
            session_id: session.id,
            name: parsed.args.name,
          });
          if (!added.ok) return fail(added.error.message);
          onSessionChanged();
          return respond(`Đã thêm ${parsed.args.name} vào phiên.`);
        }

        case "end_session": {
          const ended = tools.end_session({ session_id: session.id });
          if (!ended.ok) return fail(ended.error.message);
          onSessionChanged();
          return respond(
            `Kết thúc phiên. ${describeScoreboard(ended.data.scoreboard)}`,
          );
        }

        case "clarify": {
          questionRef.current = parsed.args.question;
          setAgentSays(parsed.args.question);
          speak(parsed.args.question);
          return setState("clarifying");
        }

        case "unsupported":
          return respond(parsed.args.reply);
      }
    },
    [session, tools, nameOf, proposeOrExecute, respond, fail, onSessionChanged],
  );

  const processUtterance = useCallback(
    async (text: string) => {
      if (!session) return;
      setTranscript(text);

      // Đang chờ "ừ/không"? Xử lý riêng trước khi gọi LLM — tiết kiệm quota
      // và phản hồi tức thì.
      if (state === "confirming" && pendingRef.current) {
        const answer = readConfirmation(text);
        if (answer === "yes") {
          const action = pendingRef.current;
          pendingRef.current = null;
          return execute(action);
        }
        if (answer === "no") {
          pendingRef.current = null;
          return respond("Được, bỏ qua. Nói lại giúp nhé.");
        }
        // "unclear" = người dùng đang sửa nội dung → hiểu lại như câu mới.
        pendingRef.current = null;
      }

      setState("understanding");
      const parsed = await interpret(
        text,
        buildContext(session, questionRef.current ?? undefined),
      );
      questionRef.current = null;
      handleIntent(parsed);
    },
    [session, state, execute, respond, handleIntent],
  );

  const startTurn = useCallback(() => {
    if (!session) return;
    setError(null);
    setTranscript("");
    stopSpeaking();

    listenerRef.current = startListening({
      onPartial: setTranscript,
      onFinal: (text) => void processUtterance(text),
      onError: fail,
    });
    if (listenerRef.current) setState("listening");
  }, [session, processUtterance, fail]);

  const endTurn = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
  }, []);

  const cancelTurn = useCallback(() => {
    listenerRef.current?.abort();
    listenerRef.current = null;
    pendingRef.current = null;
    questionRef.current = null;
    stopSpeaking();
    setState("idle");
  }, []);

  /** Nút bấm trên màn hình cho câu xác nhận — không phải ai cũng muốn nói tiếp. */
  const confirmByTap = useCallback(
    (accept: boolean) => {
      const action = pendingRef.current;
      pendingRef.current = null;
      if (!action) return;
      if (accept) return execute(action);
      respond("Được, bỏ qua.");
    },
    [execute, respond],
  );

  const view: ConversationView = {
    state,
    transcript,
    agentSays,
    pendingPrompt: state === "confirming" ? agentSays : null,
    error,
  };

  return { view, startTurn, endTurn, cancelTurn, confirmByTap };
}
