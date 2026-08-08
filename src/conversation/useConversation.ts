/**
 * State machine một lượt nói — xem docs/product/voice-pipeline.md.
 *
 * Idle → Listening → Understanding → [Confirming] → Idle
 *
 * File này chỉ còn lo phần GIỌNG NÓI: thu âm, nhận "ừ/không", đọc câu trả lời.
 * Mọi quyết định làm gì nằm ở server (ADR 13) — client gửi một câu và nhận kết
 * quả, không biết tool nào tồn tại.
 *
 * Bất biến giữ nguyên: mọi hành động THAY ĐỔI ĐIỂM đều qua chốt xác nhận, và
 * chốt đó khai ở TOOL phía server chứ không do model quyết (ADR 12).
 */

import { useCallback, useRef, useState } from "react";
import type { AgentOutcome, ProposalRow, RoundOrder } from "../api/model";
import { ApiError, confirmPending, sendUtterance, type AgentReply } from "../api/client";
import { startListening, speak, stopSpeaking, type Listener } from "../voice/speech";
import { readConfirmation } from "./phrases";

export type VoiceState = "idle" | "listening" | "understanding" | "confirming";

export interface ConversationView {
  state: VoiceState;
  transcript: string;
  agentSays: string;
  pendingPrompt: string | null;
  /**
   * T — cho NHÌN THẤY con số agent định ghi, không chỉ nghe đọc.
   * Nghe "Hùng trừ một" dễ trôi; thấy "Hùng −1" thì sai là biết ngay.
   */
  proposal: ProposalRow[] | null;
  error: string | null;
  lastTranscript: string;
  canRetry: boolean;
  /** Agent nghĩ mấy bước cho câu vừa rồi — mỗi bước là một lượt gọi Gemini. */
  steps: number;
}

export function useConversation(
  sessionId: string | null,
  onAgentReply: (reply: AgentReply) => void,
  setRoundOrder: (order: RoundOrder) => void,
) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [says, setSays] = useState("");
  const [pending, setPending] = useState<{
    prompt: string;
    rows: ProposalRow[] | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [steps, setSteps] = useState(0);

  const listenerRef = useRef<Listener | null>(null);
  // Ref chứ không state: `processUtterance` phải đọc được giá trị MỚI NHẤT ngay
  // trong cùng một lượt, trước khi React kịp render lại.
  const pendingRef = useRef(false);

  const say = useCallback((text: string) => {
    if (text) speak(text);
  }, []);

  /** Áp kết quả một lượt agent lên màn hình. */
  const apply = useCallback(
    (reply: AgentReply) => {
      onAgentReply(reply);
      if (reply.uiIntents?.roundOrder) setRoundOrder(reply.uiIntents.roundOrder);
      setSteps(reply.steps);
      setError(null);
      setRetryable(false);

      const outcome: AgentOutcome = reply.outcome;
      if (outcome.type === "confirm") {
        pendingRef.current = true;
        setPending({ prompt: outcome.prompt, rows: outcome.rows });
        setSays(outcome.prompt);
        setState("confirming");
        say(outcome.prompt);
        return;
      }

      pendingRef.current = false;
      setPending(null);
      setState("idle");

      const text =
        outcome.type === "final"
          ? outcome.text
          : outcome.type === "clarify"
            ? outcome.question
            : outcome.message;

      if (outcome.type === "error") {
        setError(outcome.message);
        setRetryable(outcome.retryable);
      }
      setSays(text);
      say(text);
    },
    [onAgentReply, setRoundOrder, say],
  );

  const fail = useCallback(
    (err: unknown) => {
      pendingRef.current = false;
      setPending(null);
      setState("idle");

      const message =
        err instanceof ApiError ? err.message : "Có lỗi, thử lại giúp nhé.";
      setError(message);
      setRetryable(err instanceof ApiError ? err.retryable : true);
      setSays("");
      say(message);
    },
    [say],
  );

  const processUtterance = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      setTranscript(text);
      setLastTranscript(text);
      setError(null);

      try {
        // Đang chờ "ừ/không"? Trả lời tại chỗ, khỏi tốn một lượt gọi model.
        if (pendingRef.current) {
          const answer = readConfirmation(text);
          if (answer === "yes") return apply(await confirmPending(sessionId, true));
          if (answer === "no") return apply(await confirmPending(sessionId, false));
          // "unclear" = người dùng đang sửa nội dung → bỏ đề xuất cũ, coi như
          // câu mới. Server cũng tự bỏ khi nhận câu mới, gọi đây cho chắc.
          await confirmPending(sessionId, false).catch(() => {});
          pendingRef.current = false;
        }

        setState("understanding");
        apply(await sendUtterance(sessionId, text));
      } catch (err) {
        fail(err);
      }
    },
    [sessionId, apply, fail],
  );

  const startTurn = useCallback(() => {
    if (!sessionId) return;
    setError(null);
    setTranscript("");
    stopSpeaking();

    listenerRef.current = startListening({
      onPartial: setTranscript,
      onFinal: (text) => void processUtterance(text),
      onError: (message) => fail(new ApiError("SPEECH", message, true)),
    });
    if (listenerRef.current) setState("listening");
  }, [sessionId, processUtterance, fail]);

  const endTurn = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
  }, []);

  const cancelTurn = useCallback(() => {
    listenerRef.current?.abort();
    listenerRef.current = null;
    stopSpeaking();
    setState(pendingRef.current ? "confirming" : "idle");
  }, []);

  /** Nút bấm cho câu xác nhận — không phải ai cũng muốn nói tiếp. */
  const confirmByTap = useCallback(
    async (accepted: boolean) => {
      if (!sessionId) return;
      pendingRef.current = false;
      setPending(null);
      setState("understanding");
      try {
        apply(await confirmPending(sessionId, accepted));
      } catch (err) {
        fail(err);
      }
    },
    [sessionId, apply, fail],
  );

  /** Chạy lại đúng câu vừa nói — không bắt nói lại, không đụng micro. */
  const retry = useCallback(() => {
    if (lastTranscript) void processUtterance(lastTranscript);
  }, [lastTranscript, processUtterance]);

  const view: ConversationView = {
    state,
    transcript,
    agentSays: says,
    pendingPrompt: pending?.prompt ?? null,
    proposal: pending?.rows ?? null,
    error,
    lastTranscript,
    canRetry: retryable && Boolean(lastTranscript) && state !== "understanding",
    steps,
  };

  return { view, startTurn, endTurn, cancelTurn, confirmByTap, retry };
}
