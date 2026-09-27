"""Build the case-study page (site/index.html) from the repo's own evidence. No number is typed by hand.

    python3 tools/case_study.py

Sources
- results/live-2026-09-27.json     the live run through a public URL (times, scores, row)
- results/live-rule-breakdown.json rule factors for that lead (tools/rule-breakdown.mjs)
- results/e2e-2026-09-26.json      the 10 dev scenarios and every check
- src/lib/combine.js               weights, disagreement threshold, tiers
- tools/gate.mjs, tools/live-lead.mjs, README.md ("Known limits")
- docs/img/*.png                   screenshots of the live run (address redacted)
Standard library only.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import shutil
from pathlib import Path
from string import Template

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
REPO = "https://github.com/kulieff21/lead-intake-n8n-demo"
TZ = dt.timezone(dt.timedelta(hours=4))  # the phone's clock (Baku)


def read(p: str) -> str:
    return (ROOT / p).read_text(encoding="utf-8")


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def mask(s: str) -> str:
    return re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+", lambda m: m.group(0) if m.group(0).endswith(".example") else "[address]", s)


def iso(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def md_inline(s: str) -> str:
    s = esc(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", s)


LIVE = json.loads(read("results/live-2026-09-27.json"))
RULE = json.loads(read("results/live-rule-breakdown.json"))
E2E = json.loads(read("results/e2e-2026-09-26.json"))
COMBINE = read("src/lib/combine.js")
GATE = read("tools/gate.mjs")
LEAD_SRC = read("tools/live-lead.mjs")
README = read("README.md")

# ---- live run timeline (seconds from the form POST) ----
row = LIVE["row"]
t_end = iso(LIVE["at"])
t0 = t_end - dt.timedelta(milliseconds=LIVE["marks"]["decided"])
T_ACK = LIVE["ack"]["ms"] / 1000
T_PEND = LIVE["marks"]["pending"] / 1000
T_DONE = (iso(row["replied_at"]) - t0).total_seconds()
assert T_ACK < T_PEND < T_DONE
_l = t0.astimezone(TZ)
CLOCK0 = _l.hour * 3600 + _l.minute * 60 + _l.second + _l.microsecond / 1e6  # seconds since local midnight

# ---- scoring constants, read from the code the workflow runs ----
W_RULE, W_AI = map(float, re.search(r"Math\.round\(([\d.]+) \* rule\.score \+ ([\d.]+) \* aiResult", COMBINE).groups())
DISAGREE = int(re.search(r"DISAGREEMENT = (\d+)", COMBINE).group(1))
HOT, WARM = map(int, re.search(r"final >= (\d+) \? 'hot' : final >= (\d+)", COMBINE).groups())
AI = int(row["ai_fit_score"])
FINAL = int(row["final_score"])
assert round(W_RULE * RULE["score"] + W_AI * AI) == FINAL, "final score does not follow combine.js"

checks = {r["name"]: r for r in E2E["results"]}
assert E2E["pass"] == E2E["scenarios"] == len(checks)
inj_detail = next(c["detail"] for c in checks["prompt-injection"]["checks"] if c["label"] == "flagged for review")
INJ_RULE, INJ_AI = map(int, re.search(r"rule (\d+) vs AI (\d+)", inj_detail).groups())
INJ_MSG = re.search(r"message: '(IMPORTANT SYSTEM NOTE[^']*)'", read("tools/e2e.mjs")).group(1)

LEAD = dict(re.findall(r"(\w+): '([^']*)'", LEAD_SRC))
GATE_ROUTES = [("POST", re.search(r"method === 'POST' && path === '([^']+)'", GATE).group(1)),
               ("GET", "/webhook-waiting/<id>")]
assert "webhook-waiting" in GATE

limits_md = README.split("## Known limits", 1)[1].split("\n## ", 1)[0]
LIMITS = [re.sub(r"\s+", " ", b).strip() for b in re.split(r"\n- ", "\n" + limits_md.strip()) if b.strip()]


def fmt_dur(s: float) -> str:
    m, sec = divmod(round(s), 60)
    return f"{m} min {sec} s" if m else f"{sec} s"


# ---- sections ----
SCEN = {  # scenario name → (title, one-line outcome); outcomes are backed by the checks shown under them
    "approve": ("Approve", "reply emailed, row replied; a second click does not resend"),
    "invalid": ("Invalid form", "422 with every error, not the first one"),
    "spam": ("Spam (honeypot)", "202 like a real lead; no row, no message"),
    "duplicate": ("Duplicate", "same person, different spelling → one row, counted twice"),
    "reject": ("Reject", "no email"),
    "prompt-injection": ("Prompt injection", "the model did not obey; flagged for the reviewer"),
    "ai-down": ("LLM down", "saved on the rule score; approving sends nothing"),
    "expired": ("Nobody clicks", "row expired, no email"),
    "smtp-down": ("Mail server down", "no “Reply sent”; error row and alert"),
    "error-workflow": ("CRM step broken", "caller still gets 202; the alert names the node"),
}
assert set(SCEN) == set(checks)

STATIONS = [
    ("Form webhook", "answers before any work is done", [], f"202 in {T_ACK:.1f} s"),
    ("Normalize", "validate, clean, honeypot", ["invalid", "spam"], "valid"),
    ("Seen before?", "lookup in the Sheets CRM", ["duplicate"], "new lead"),
    ("Rule score + LLM", "two scores, strict JSON schema", ["ai-down", "prompt-injection"], f"{FINAL} {row['tier']}"),
    ("Ask reviewer", "Telegram, signed links, 48 h", ["reject", "expired"], "approved"),
    ("Send reply", "then mark the row replied", ["smtp-down"], "replied"),
]


def scenario_rows() -> str:
    out = []
    for name in SCEN:
        title, outcome = SCEN[name]
        r = checks[name]
        items = "".join(
            f'<li><span class="ck">{"✓" if c["ok"] else "✗"}</span><span class="lb">{esc(c["label"])}</span>'
            f'{"<code>" + esc(mask(c["detail"])[:170]) + ("…" if len(c["detail"]) > 170 else "") + "</code>" if c["detail"] else ""}</li>'
            for c in r["checks"])
        opened = " open" if name == "prompt-injection" else ""
        out.append(f'<details class="sc" id="sc-{name}"{opened}><summary><span class="pass">pass</span><b>{esc(title)}</b>'
                   f'<span class="oc">{esc(outcome)}</span><span class="ms">{r["ms"] / 1000:.1f} s</span></summary><ul>{items}</ul></details>')
    return "".join(out)


def stations_html() -> str:
    cols = []
    for i, (name, what, exits, ok) in enumerate(STATIONS):
        ex = "".join(f'<a class="exit" href="#sc-{e}" style="--d:{i * 0.35 + 0.9 + j * 0.15:.2f}s"><i></i>{esc(SCEN[e][0])}'
                     f'<span>{esc(SCEN[e][1])}</span></a>' for j, e in enumerate(exits))
        cols.append(f'<div class="stn" style="--d:{i * 0.35:.2f}s"><div class="node"><span class="n">{i + 1:02d}</span>'
                    f'<b>{esc(name)}</b><span class="w">{esc(what)}</span></div><div class="okl">{esc(ok)}</div>{ex}</div>')
    return "".join(cols)


def factors_html() -> str:
    segs, rows = [], []
    for i, f in enumerate(RULE["factors"]):
        segs.append(f'<span class="seg s{i % 3}" style="--w:{f["points"]}%;--d:{i * 0.12:.2f}s" title="{esc(f["factor"])}: {f["points"]}"></span>')
        rows.append(f'<li><span>{esc(f["factor"])}</span><b>+{f["points"]}</b></li>')
    miss = "company mailbox" if RULE["mailbox"] == "free" else None
    if miss:
        rows.append('<li class="miss"><span>company mailbox (the test address is Gmail)</span><b>+0</b></li>')
    return "".join(segs), "".join(rows)


def page() -> str:
    segs, frows = factors_html()
    limits = "".join(f"<li>{md_inline(b)}</li>" for b in LIMITS)
    lead_rows = "".join(f'<div><span>{k}</span> {esc(v)}</div>' for k, v in LEAD.items()
                        if k in ("name", "company", "budget", "timeline", "message"))
    routes = "".join(f'<li class="ok"><code>{m} {esc(p)}</code><span>passes</span></li>' for m, p in GATE_ROUTES)
    denied = "".join(f'<li class="no"><code>GET {p}</code><span>404</span></li>' for p in ("/", "/rest/settings", "/api/v1/workflows"))
    tpl = Template(read("tools/case_study.html"))
    return tpl.substitute(
        repo=REPO,
        t_ack=f"{T_ACK:.1f}", t_pend=f"{T_PEND:.1f}", t_pend_r=f"{T_PEND:.0f}", t_done=f"{T_DONE:.1f}",
        human=fmt_dur(T_DONE - T_PEND), clock0=CLOCK0,
        pct_ack=f"{T_ACK / T_DONE * 100:.3f}", pct_pend=f"{T_PEND / T_DONE * 100:.3f}",
        rule=RULE["score"], ai=AI, final=FINAL, tier=row["tier"], w_rule=f"{W_RULE:g}", w_ai=f"{W_AI:g}",
        final_raw=f"{W_RULE * RULE['score'] + W_AI * AI:.1f}", disagree=DISAGREE, hot=HOT, warm=WARM,
        inj_rule=INJ_RULE, inj_ai=INJ_AI, inj_msg=esc(INJ_MSG), segs=segs, frows=frows,
        summary=esc(row["summary"]), draft=esc(row["reply_draft"]),
        n_pass=E2E["pass"], n_scen=E2E["scenarios"], model=esc(E2E["model"]), live_model=esc(LIVE["services"]["llm"]),
        stations=stations_html(), scenarios=scenario_rows(), limits=limits, lead_rows=lead_rows,
        routes=routes, denied=denied,
    )


def main() -> None:
    (SITE / "img").mkdir(parents=True, exist_ok=True)
    for f in (ROOT / "docs" / "img").glob("*.png"):
        shutil.copy(f, SITE / "img" / f.name)
    (SITE / "index.html").write_text(page(), encoding="utf-8")
    print("site/index.html", (SITE / "index.html").stat().st_size, "bytes")


if __name__ == "__main__":
    main()
