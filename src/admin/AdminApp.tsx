import { useCallback, useEffect, useState } from "react";
import {
  getStats,
  listSessions,
  listTurns,
  type AdminSession,
  type Stats,
  type TraceStep,
  type TraceTurn,
} from "./api";

/**
 * Trang quan sát agent (C-023) — dành cho người phát triển, không phải người chơi.
 *
 * Câu hỏi nó phải trả lời được: "lượt vừa rồi agent thấy gì, quyết gì, và bị
 * chặn ở đâu". Nên mặc định hiện chuỗi ReAct; prompt và observation dài thì thu
 * lại, bấm mới mở — nếu bày hết ra thì cái cần nhìn bị chôn.
 */

const OUTCOME_LABEL: Record<string, string> = {
  final: "trả lời",
  confirm: "chờ chốt",
  clarify: "hỏi lại",
  error: "lỗi",
  blocked: "bị chặn",
};

function Collapsible({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="adm-fold">
      <button type="button" className="adm-fold-head" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {title}
      </button>
      {open && <pre className="adm-pre">{body}</pre>}
    </div>
  );
}

function Step({ step }: { step: TraceStep }) {
  return (
    <div className="adm-step">
      <div className="adm-step-head">
        <span className="adm-step-no">bước {step.index}</span>
        {step.modelMs !== null && <span className="adm-ms">model {step.modelMs}ms</span>}
        {step.toolMs !== null && <span className="adm-ms">tool {step.toolMs}ms</span>}
      </div>

      {step.thought && (
        <div className="adm-line">
          <span className="adm-tag adm-thought">THOUGHT</span>
          <span>{step.thought}</span>
        </div>
      )}

      {step.tool && (
        <div className="adm-line">
          <span className="adm-tag adm-action">ACTION</span>
          <span>
            <code>{step.tool}</code>
            <code className="adm-args">({JSON.stringify(step.args ?? {})})</code>
          </span>
        </div>
      )}

      {step.observation !== null && step.observation !== undefined && (
        <Collapsible
          title="OBSERVATION"
          body={JSON.stringify(step.observation, null, 2)}
        />
      )}
      {step.prompt && (
        <Collapsible title={`PROMPT (${step.prompt.length} ký tự)`} body={step.prompt} />
      )}
    </div>
  );
}

function Turn({ turn }: { turn: TraceTurn }) {
  return (
    <article className="adm-turn">
      <header className="adm-turn-head">
        <span className="adm-said">{turn.text}</span>
        <span className={`adm-outcome adm-${turn.outcome}`}>
          {OUTCOME_LABEL[turn.outcome ?? ""] ?? turn.outcome}
        </span>
        {turn.totalMs !== null && <span className="adm-ms">{turn.totalMs}ms</span>}
      </header>

      {turn.guardrails.length > 0 && (
        <div className="adm-guards">
          {turn.guardrails.map((g, i) => (
            <span key={i} className="adm-guard" title={JSON.stringify(g.detail)}>
              ⚑ {g.name}
            </span>
          ))}
        </div>
      )}

      {turn.steps.length === 0 ? (
        <p className="adm-empty">Không gọi model lần nào.</p>
      ) : (
        turn.steps.map((s) => <Step key={s.index} step={s} />)
      )}
    </article>
  );
}

function StatsPanel({ stats }: { stats: Stats }) {
  const entries = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]);
  return (
    <section className="adm-stats">
      <div className="adm-stat">
        <b>{stats.turns}</b> lượt
      </div>
      <div className="adm-stat">
        độ trễ <b>{stats.latencyMs.p50}ms</b> p50 · <b>{stats.latencyMs.p95}ms</b> p95
      </div>
      <div className="adm-stat">
        số bước tb <b>{stats.steps.avg}</b> · nhiều nhất <b>{stats.steps.max}</b>
      </div>
      <div className="adm-stat">
        kết cục:{" "}
        {entries(stats.outcomes).map(([k, v]) => (
          <span key={k} className="adm-chip">
            {OUTCOME_LABEL[k] ?? k} {v}
          </span>
        ))}
      </div>
      <div className="adm-stat">
        guardrail:{" "}
        {entries(stats.guardrails).length === 0 ? (
          <span className="adm-dim">chưa chặn lần nào</span>
        ) : (
          entries(stats.guardrails).map(([k, v]) => (
            <span key={k} className="adm-chip adm-chip-warn">
              {k} {v}
            </span>
          ))
        )}
      </div>
    </section>
  );
}

export function AdminApp() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [turns, setTurns] = useState<TraceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([listSessions(), getStats()]);
      setSessions(list);
      setStats(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!picked) return;
    void listTurns(picked)
      .then(setTurns)
      .catch((err) => setError(err instanceof Error ? err.message : "Lỗi"));
  }, [picked]);

  if (loading) return <div className="adm"><p>Đang tải…</p></div>;

  if (error) {
    return (
      <div className="adm">
        <h1>Quan sát agent</h1>
        <p className="adm-error">{error}</p>
        <p className="adm-dim">
          Mở bằng <code>/admin?token=…</code>
        </p>
      </div>
    );
  }

  return (
    <div className="adm">
      <header className="adm-top">
        <h1>Quan sát agent</h1>
        <button type="button" className="adm-btn" onClick={() => void refresh()}>
          Tải lại
        </button>
      </header>

      {stats && <StatsPanel stats={stats} />}

      <div className="adm-body">
        <aside className="adm-list">
          <h2>Phiên ({sessions.length})</h2>
          {sessions.length === 0 && <p className="adm-dim">Chưa có lượt nói nào.</p>}
          {sessions.map((s) => (
            <button
              type="button"
              key={s.sessionId}
              className={`adm-sess${picked === s.sessionId ? " on" : ""}`}
              onClick={() => setPicked(s.sessionId)}
            >
              <span className="adm-sess-who">
                {s.players.join(", ") || s.sessionId}
              </span>
              <span className="adm-dim">
                {s.turns} lượt · {s.rounds} ván · {s.status}
              </span>
              <span className="adm-dim adm-tiny">{s.deviceId ?? "?"}</span>
            </button>
          ))}
        </aside>

        <main className="adm-turns">
          {!picked && <p className="adm-dim">Chọn một phiên để xem chuỗi ReAct.</p>}
          {picked && turns.length === 0 && <p className="adm-dim">Phiên này chưa có vết.</p>}
          {turns.map((t) => (
            <Turn key={t.id} turn={t} />
          ))}
        </main>
      </div>
    </div>
  );
}
