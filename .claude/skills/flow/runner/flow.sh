#!/usr/bin/env bash
# flow.sh — deterministic gate-checker for the buildflow method.
# The files ARE the state: current stage = highest NN-*.md present in flow/.
#
# Subcommands:
#   status            Where am I? What's blocking?
#   next              Check current stage gate; unlock next stage template.
#   card              Create the next build card (cards/C-NNN.md).
#   check <C-NNN>     Validate a card (no [FILL], verify steps, done-evidence).
#   mode [teach|work] Show or set the operating mode (MODE file; default teach).
#   ready             Which todo cards can be built NOW — deps met — and which of
#                     those can run IN PARALLEL (no allowed-files overlap). Advisory:
#                     the operator dispatches; see CLAUDE.md worktree protocol.
#   auto              PREFLIGHT for an autonomous build run (planning complete, all
#                     cards well-formed, deps declared). Deterministic checks only;
#                     the drive protocol + principles live in SKILL.md (## auto).
#   retro             Retro state: cards done vs open, RETRO.md entry count, unfiled-
#                     lesson hints. The 3-question protocol lives in SKILL.md (## retro).
#
# Exit codes: 0 ok | 1 gate fail / validation fail | 2 usage

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FLOW="$ROOT/flow"
CARDS="$ROOT/cards"
TPL="$ROOT/_templates"

STAGES=(00-idea 01-research 02-scope 03-prd 04-adr 05-contract)

die() { echo "flow: $*" >&2; exit 2; }

current_mode() { [ -f "$ROOT/MODE" ] && tr -d '[:space:]' < "$ROOT/MODE" || echo "teach"; }

cmd_mode() {
    if [ $# -eq 0 ]; then echo "mode: $(current_mode)"; return 0; fi
    case "$1" in
        teach|work) printf '%s\n' "$1" > "$ROOT/MODE"; echo "mode set: $1" ;;
        *) die "mode must be 'teach' or 'work'" ;;
    esac
}

# --- helpers ---------------------------------------------------------------

current_stage_idx() {
    # highest stage whose file exists in flow/; -1 if none
    local i=-1 n=0
    for s in "${STAGES[@]}"; do
        [ -f "$FLOW/$s.md" ] && i=$n
        n=$((n+1))
    done
    echo "$i"
}

# Print gate problems for a file (one per line). Empty output = gate passes.
gate_problems() {
    local f="$1"
    # 1. unchecked boxes inside the "## Gate" section
    awk '/^## Gate/{g=1; next} /^## /{g=0} g && /^- \[ \]/{print "unchecked: " $0}' "$f"
    # 2. any [FILL marker anywhere
    grep -n '\[FILL' "$f" 2>/dev/null | sed 's/^/placeholder at line /' || true
}

card_problems() {
    local f="$1"
    grep -n '\[FILL' "$f" 2>/dev/null | sed 's/^/placeholder at line /' || true
    grep -q '^## Verify' "$f" || echo "missing '## Verify' section"
    awk '/^## Verify/{v=1; next} /^## /{v=0} v && /^- \[[ x]\]/{found=1} END{exit !found}' "$f" \
        || echo "no verify checklist items under '## Verify'"
    grep -q '^## Done-evidence' "$f" || echo "missing '## Done-evidence' section"
    # if status: done → all verify boxes checked + Evidence section non-empty
    if grep -q '^status: done' "$f"; then
        awk '/^## Verify/{v=1; next} /^## /{v=0} v && /^- \[ \]/{u=1} END{exit !u}' "$f" \
            && echo "status is done but Verify has unchecked boxes"
        awk '/^## Evidence/{e=1; next} /^## /{e=0} e && NF && $0 !~ /^\(empty/{found=1} END{exit !found}' "$f" \
            || echo "status is done but '## Evidence' has no pasted proof"
    fi
    true
}

all_cards() { ls "$CARDS"/C-*.md 2>/dev/null || true; }

# "Contract coverage: N/M endpoints referenced in cards" (+ missing list).
contract_coverage() {
    local cf="$FLOW/05-contract.md"
    [ -f "$cf" ] || return 0
    local cards; cards=$(all_cards); [ -n "$cards" ] || return 0
    local total=0 covered=0 missing=""
    while IFS= read -r p; do
        [ -n "$p" ] || continue
        total=$((total+1))
        if grep -qF -- "$p" $cards 2>/dev/null; then covered=$((covered+1)); else missing="$missing $p"; fi
    done < <(awk -F'|' '/^\|/{m=$2; p=$3; gsub(/[ `]/,"",m); gsub(/[` ]/,"",p);
             if (m ~ /^(GET|POST|PUT|PATCH|DELETE)$/ && p ~ /^\//) {sub(/\?.*/,"",p); print p}}' "$cf" | sort -u)
    [ "$total" -gt 0 ] || return 0
    if [ -n "$missing" ]; then
        echo "Contract coverage: $covered/$total endpoints referenced in cards — no card mentions:$missing"
    else
        echo "Contract coverage: $covered/$total endpoints referenced in cards."
    fi
}

card_status_line() {
    local f="$1" st title
    st=$(grep -m1 '^status:' "$f" | sed 's/^status: *//' || echo "?")
    title=$(head -1 "$f" | sed 's/^# *//')
    echo "  [$st] $title"
}

# --- status ----------------------------------------------------------------

cmd_status() {
    local idx; idx=$(current_stage_idx)
    echo "buildflow @ $ROOT   [mode: $(current_mode)]"
    if [ -f "$ROOT/DEBT.md" ]; then
        local _debts; _debts=$(grep -c '^- \[ \]' "$ROOT/DEBT.md" 2>/dev/null || true)
        [ "$_debts" -gt 0 ] && echo "OPEN DEBT: $_debts gate-skip(s) — DEBT.md"
    fi
    echo
    if [ "$idx" -lt 0 ]; then
        echo "Not started. Run: /flow next  (unlocks stage 00-idea)"
        return 0
    fi
    local cur="${STAGES[$idx]}"
    echo "Planning stages:"
    local n=0
    for s in "${STAGES[@]}"; do
        if [ -f "$FLOW/$s.md" ]; then
            local p; p=$(gate_problems "$FLOW/$s.md")
            if [ -z "$p" ]; then echo "  [gate ✓] $s"; else echo "  [open  ] $s"; fi
        else
            echo "  [locked] $s"
        fi
        n=$((n+1))
    done
    echo
    local probs; probs=$(gate_problems "$FLOW/$cur.md")
    if [ -n "$probs" ]; then
        echo "Current stage: $cur — gate NOT passed:"
        echo "$probs" | sed 's/^/  - /'
        echo
        echo "Fix the items above in flow/$cur.md, then run: /flow next"
    elif [ "$idx" -lt $((${#STAGES[@]}-1)) ]; then
        echo "Current stage: $cur — gate passed. Run: /flow next"
    else
        echo "Planning complete (all 6 stage gates passed)."
        echo
        echo "Cards:"
        local cards; cards=$(all_cards)
        if [ -z "$cards" ]; then
            echo "  (none yet) — run: /flow card"
        else
            local alldone=1 open=""
            for c in $cards; do
                card_status_line "$c"
                if ! grep -q '^status: done' "$c"; then
                    alldone=0
                    open="$open $(basename "$c" .md)"
                fi
            done
            echo
            contract_coverage
            if [ "$alldone" -eq 1 ]; then
                echo "All cards done. Final step: append one line to RETRO.md —"
                echo "  'Which gate did I skip or rush, and what did it cost?'"
            else
                echo "Still open:$open — build ONE card at a time; done = evidence pasted in ## Evidence."
            fi
        fi
    fi
}

# --- next ------------------------------------------------------------------

cmd_next() {
    local idx; idx=$(current_stage_idx)
    if [ "$idx" -lt 0 ]; then
        cp "$TPL/00-idea.md" "$FLOW/00-idea.md"
        echo "Stage 00 unlocked → flow/00-idea.md. Fill it, check its gate boxes, then /flow next."
        return 0
    fi
    local cur="${STAGES[$idx]}"
    local probs; probs=$(gate_problems "$FLOW/$cur.md")
    if [ -n "$probs" ]; then
        echo "GATE FAIL — $cur is not done:"
        echo "$probs" | sed 's/^/  - /'
        echo
        echo "No advance. Fix flow/$cur.md first. (Killing the idea here is also a valid exit.)"
        exit 1
    fi
    if [ "$idx" -ge $((${#STAGES[@]}-1)) ]; then
        echo "Planning complete — all 6 gates passed."
        echo "Next: /flow card  (create C-001; vertical slice to a deployed URL first)"
        return 0
    fi
    local nxt="${STAGES[$((idx+1))]}"
    cp "$TPL/$nxt.md" "$FLOW/$nxt.md"
    echo "Gate ✓ on $cur."
    echo "Stage unlocked → flow/$nxt.md. Fill it, check its gate boxes, then /flow next."
}

# --- card ------------------------------------------------------------------

cmd_card() {
    local idx; idx=$(current_stage_idx)
    local last=$((${#STAGES[@]}-1))
    if [ "$idx" -lt "$last" ] || [ -n "$(gate_problems "$FLOW/${STAGES[$last]}.md" 2>/dev/null)" ]; then
        echo "REFUSED — cards open only after ALL planning gates pass (run /flow status)." >&2
        exit 1
    fi
    local n=1 open=0
    while [ -f "$CARDS/$(printf 'C-%03d' "$n").md" ]; do
        grep -q '^status: done' "$CARDS/$(printf 'C-%03d' "$n").md" || open=$((open+1))
        n=$((n+1))
    done
    local id; id=$(printf 'C-%03d' "$n")
    sed "s/C-NNN/$id/" "$TPL/card.md" > "$CARDS/$id.md"
    echo "Created cards/$id.md — fill scope/allowed-files/verify/done-evidence, then build."
    if [ "$n" -eq 1 ]; then
        echo "ORDER RULE: C-001 is the VERTICAL SLICE — one endpoint + one ugly page that calls it,"
        echo "deployed to a real URL. Prove the seam works in production before going wide. UI layer last."
    elif [ "$open" -gt 0 ]; then
        echo "NOTE: you have $open unfinished card(s). The method is BUILD ONE CARD AT A TIME —"
        echo "planning all cards up front is fine; building in parallel is not."
    fi
    echo "Validate any time with: /flow check $id"
}

# --- check -----------------------------------------------------------------

cmd_check() {
    [ $# -ge 1 ] || die "check <C-NNN>"
    local id="$1"
    local f="$CARDS/$id.md"
    [ -f "$f" ] || f="$id"           # allow a path
    [ -f "$f" ] || die "no such card: $1"
    local probs; probs=$(card_problems "$f")
    if [ -n "$probs" ]; then
        echo "CARD FAIL — $1:"
        echo "$probs" | sed 's/^/  - /'
        exit 1
    fi
    echo "Card OK: $1"
    if ! grep -q '^status: done' "$f"; then
        echo "(status is not 'done' — set it only when Evidence holds real world-state proof)"
    fi
}

# --- ready (parallel advisor) ----------------------------------------------

cmd_ready() {
    local cards; cards=$(all_cards)
    [ -n "$cards" ] || { echo "No cards yet — /flow card"; return 0; }
    python3 - "$CARDS" <<'PYEOF'
import re, sys, glob, os, itertools

cards_dir = sys.argv[1]
cards = {}
for p in sorted(glob.glob(os.path.join(cards_dir, "C-*.md"))):
    cid = os.path.basename(p)[:-3]
    text = open(p).read()
    status = (re.search(r"^status:\s*(\w+)", text, re.M) or [None, "todo"])[1]
    dm = re.search(r"^deps:\s*(.+)$", text, re.M)
    deps = []
    if dm and "FILL" not in dm.group(1):
        deps = re.findall(r"C-\d+", dm.group(1))
    elif dm is None:
        deps = None  # legacy card without deps line
    # allowed-file tokens: path-like strings in the Allowed files section, minus NOT lines
    files = []
    sec = re.search(r"^## Allowed files\n(.*?)(?=^## )", text, re.M | re.S)
    if sec:
        for line in sec.group(1).splitlines():
            if re.match(r"\s*-?\s*NOT", line, re.I):
                continue
            for tok in re.findall(r"[\w.\-/]+(?:/[\w.\-/*]+|\.\w{1,5})", line):
                files.append(tok.rstrip("/").rstrip(","))
    cards[cid] = dict(status=status, deps=deps, files=set(files))

done = {c for c, d in cards.items() if d["status"] == "done"}
todo = {c for c, d in cards.items() if d["status"] != "done"}

def overlap(a, b):
    for x in cards[a]["files"]:
        for y in cards[b]["files"]:
            if x == y or x.startswith(y + "/") or y.startswith(x + "/"):
                return x if len(x) < len(y) else y
    return None

ready, blocked, legacy = [], [], []
for c in sorted(todo):
    d = cards[c]["deps"]
    if d is None:
        legacy.append(c); ready.append(c)  # no deps line: assume ready, warn below
    elif all(x in done for x in d):
        ready.append(c)
    else:
        blocked.append((c, [x for x in d if x not in done]))

print(f"DONE: {', '.join(sorted(done)) or '—'}")
print(f"\nREADY now ({len(ready)}):")
conflicts = {}
for a, b in itertools.combinations(ready, 2):
    f = overlap(a, b)
    if f:
        conflicts.setdefault(a, []).append(f"{b} ({f})")
        conflicts.setdefault(b, []).append(f"{a} ({f})")
for c in ready:
    note = " · OVERLAPS: " + "; ".join(conflicts[c]) if c in conflicts else " · no overlap"
    print(f"  {c}{note}")
# greedy parallel grouping
groups, placed = [], set()
for c in ready:
    if c in placed: continue
    grp = [c]; placed.add(c)
    for o in ready:
        if o in placed: continue
        if all(not overlap(o, g) for g in grp):
            grp.append(o); placed.add(o)
    groups.append(grp)
if groups:
    print("\nPARALLEL-SAFE groups (one worktree per card, see CLAUDE.md):")
    for i, g in enumerate(groups, 1):
        print(f"  group {i}: {', '.join(g)}")
if blocked:
    print(f"\nBLOCKED ({len(blocked)}):")
    for c, missing in blocked:
        print(f"  {c}  waiting on: {', '.join(missing)}")
if legacy:
    print(f"\nWARN no 'deps:' line (treated as ready): {', '.join(legacy)}")
PYEOF
}

# --- auto (preflight for an autonomous build run) ----------------------------

cmd_auto() {
    local last=$((${#STAGES[@]}-1)) fail=0
    local idx; idx=$(current_stage_idx)
    if [ "$idx" -lt "$last" ] || [ -n "$(gate_problems "$FLOW/${STAGES[$last]}.md" 2>/dev/null)" ]; then
        echo "PREFLIGHT FAIL — planning incomplete. Auto builds cards; it never writes plans. Run /flow status."
        fail=1
    fi
    local cards; cards=$(all_cards)
    if [ -z "$cards" ]; then
        echo "PREFLIGHT FAIL — no cards. /flow card first."
        fail=1
    fi
    local nodeps=""
    for c in $cards; do
        local p; p=$(card_problems "$c")
        if [ -n "$p" ]; then
            echo "PREFLIGHT FAIL — $(basename "$c" .md) is malformed:"
            echo "$p" | sed 's/^/    /'
            fail=1
        fi
        grep -q '^deps:' "$c" || nodeps="$nodeps $(basename "$c" .md)"
    done
    if [ -n "$nodeps" ]; then
        echo "PREFLIGHT FAIL — cards missing a 'deps:' line (auto needs the dependency graph):$nodeps"
        fail=1
    fi
    [ "$fail" -eq 1 ] && exit 1
    echo "PREFLIGHT OK — the dependency graph is complete and every card is well-formed."
    echo
    cmd_ready
    echo
    echo "Drive per the AUTO PRINCIPLES in .claude/skills/flow/SKILL.md (section '/flow auto')."
    echo "Operator-gated cards (UI-mock approval, first prod deploy) WILL halt the run by design."
}

# --- retro -------------------------------------------------------------------

cmd_retro() {
    local cards done=0 open=0
    cards=$(all_cards)
    for c in $cards; do
        if grep -q '^status: done' "$c"; then done=$((done+1)); else open=$((open+1)); fi
    done
    local entries=0
    [ -f "$ROOT/RETRO.md" ] && entries=$(grep -c '^- ' "$ROOT/RETRO.md" 2>/dev/null || true)
    echo "Cards: $done done / $open open.  RETRO.md entries: $entries."
    if [ -f "$ROOT/DEBT.md" ]; then
        local debts; debts=$(grep -c '^- \[ \]' "$ROOT/DEBT.md" 2>/dev/null || true)
        [ "$debts" -gt 0 ] && echo "OPEN DEBT: $debts deliberate gate-skip(s) unresolved — check each close-condition (DEBT.md)."
    fi
    [ "$open" -gt 0 ] && echo "(Retro any time — but the final one comes after the last card.)"
    echo
    echo "Run the 3-question retro (protocol in SKILL.md '## /flow retro'):"
    echo "  1. PROCESS  — which gate did you skip or rush, and what did it cost?    → RETRO.md"
    echo "  2. STACK    — what non-obvious lesson did a stack make you pay for?     → playbooks/"
    echo "  3. THE FLOW — what should change in buildflow itself (template, gate,"
    echo "                rule, card shape) so the next project doesn't hit this?   → FLOW-FEEDBACK.md"
    if [ -f "$ROOT/FLOW-FEEDBACK.md" ]; then
        local fb; fb=$(grep -c '^- ' "$ROOT/FLOW-FEEDBACK.md" 2>/dev/null || true)
        echo
        echo "FLOW-FEEDBACK.md has $fb item(s) waiting to be carried upstream to the buildflow repo."
    fi
}

# --- dispatch ----------------------------------------------------------------

case "${1:-status}" in
    status) cmd_status ;;
    next)   cmd_next ;;
    card)   cmd_card ;;
    check)  shift; cmd_check "$@" ;;
    mode)   shift || true; cmd_mode "$@" ;;
    ready)  cmd_ready ;;
    auto)   cmd_auto ;;
    retro)  cmd_retro ;;
    *) die "unknown subcommand '${1}' (status|next|card|check|mode|ready|auto|retro)" ;;
esac
