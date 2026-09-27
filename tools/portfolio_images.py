"""Compose the portfolio images (1000x750 CSS px, rendered at 2x) from the repo's own evidence.

    python3 tools/portfolio_images.py <out_dir>     # writes <out_dir>/*.html and <out_dir>/img/
    (then render each HTML at 1000x750, deviceScaleFactor 2)

Numbers come from results/live-2026-09-27.json and results/e2e-2026-09-26.json; the lead is the
one in tools/live-lead.mjs; screenshots are docs/img (addresses redacted). Standard library only.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "portfolio"
LIVE = json.loads((ROOT / "results" / "live-2026-09-27.json").read_text(encoding="utf-8"))
E2E = json.loads((ROOT / "results" / "e2e-2026-09-26.json").read_text(encoding="utf-8"))
LIVE_SRC = (ROOT / "tools" / "live-lead.mjs").read_text(encoding="utf-8")
E2E_SRC = (ROOT / "tools" / "e2e.mjs").read_text(encoding="utf-8")
TZ = dt.timezone(dt.timedelta(hours=4))  # the phone's clock (Baku)


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def iso(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def clock(t: dt.datetime) -> str:
    return t.astimezone(TZ).strftime("%H:%M:%S")


def lead_field(name: str) -> str:
    return re.search(rf"{name}: '([^']*)'", LIVE_SRC).group(1)


# ---- numbers ----
row = LIVE["row"]
t_end = iso(LIVE["at"])
t0 = t_end - dt.timedelta(milliseconds=LIVE["marks"]["decided"])
t_pending = t0 + dt.timedelta(milliseconds=LIVE["marks"]["pending"])
t_replied = iso(row["replied_at"])
ack_s = LIVE["ack"]["ms"] / 1000
pending_s = LIVE["marks"]["pending"] / 1000
e2e_pass, e2e_n = E2E["pass"], E2E["scenarios"]
checks = {r["name"]: {c["label"]: c for c in r["checks"]} for r in E2E["results"]}
assert all(r["pass"] for r in E2E["results"]), "portfolio claims every scenario passed"
inj = checks["prompt-injection"]
inj_fit = inj["AI did not obey (fit < 60)"]["detail"]
inj_msg = re.search(r"message: '(IMPORTANT SYSTEM NOTE[^']*)'", E2E_SRC).group(1)

FONTS = ('<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;'
         '1,6..72,400&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=block" rel="stylesheet">')

CSS = """
:root{--paper:#eceee9;--ink:#15171a;--ink2:#3d4247;--muted:#6f757b;--rule:#c9cdc6;--green:#1d7a4c;--red:#b3362c;--blue:#2a5bd7;
--serif:'Newsreader',Georgia,serif;--sans:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1000px;height:750px;overflow:hidden;background:var(--paper);color:var(--ink);font-family:var(--sans)}
body{background-image:linear-gradient(rgba(21,23,26,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(21,23,26,.028) 1px,transparent 1px);background-size:24px 24px}
.frame{position:absolute;inset:0;padding:40px 46px}
.brand{position:absolute;left:46px;right:46px;bottom:22px;display:flex;justify-content:space-between;
  font:500 .68rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--rule);padding-top:10px}
.brand b{color:var(--ink);font-weight:600}
.kick{font:500 .72rem/1.3 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--green)}
.h{font:600 2.3rem/1.06 var(--serif);letter-spacing:-.015em;margin-top:10px}
.h em{font-style:italic;font-weight:400;color:var(--green)}
.sub{font:400 1.02rem/1.5 var(--sans);color:var(--ink2);margin-top:16px}
.phone{background:#0e1318;border-radius:26px;padding:10px;box-shadow:0 22px 44px -20px rgba(21,23,26,.55),0 2px 6px rgba(21,23,26,.15)}
.phone .scr{border-radius:17px;overflow:hidden;background:#0e1318;position:relative}
.phone img{display:block;width:100%}
.stats{border-top:2.5px solid var(--ink);border-bottom:2.5px solid var(--ink)}
.stat{display:flex;align-items:baseline;gap:12px;padding:13px 0;border-top:1px dashed var(--rule)}
.stat:first-child{border-top:0}
.stat span{font:400 .98rem var(--sans);color:var(--ink2)}
.stat i{flex:1;border-bottom:1px dotted var(--muted);transform:translateY(-4px)}
.stat b{font:600 1.55rem var(--mono)}
.stat b.g{color:var(--green)}
.cap{font:italic .95rem/1.35 var(--serif);color:var(--ink2)}
.mono{font-family:var(--mono)}
"""


def page(body: str, extra_css: str = "") -> str:
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">{FONTS}<style>{CSS}{extra_css}</style></head>'
            f'<body><div class="frame">{body}</div>'
            f'<div class="brand"><span><b>Lead intake</b> · n8n · demo with synthetic data</span><span>Elmar Guliyev</span></div></body></html>')


def cover() -> str:
    body = f"""
<div style="display:grid;grid-template-columns:1fr 300px;gap:54px;height:640px">
 <div style="display:flex;flex-direction:column">
  <div class="kick">n8n · Telegram · Google Sheets · LLM</div>
  <div class="h">A lead comes in. AI scores it and drafts a reply. <em>A person approves it on their phone.</em></div>
  <div class="sub">Validated, checked against the CRM for repeats, scored by rules and by an LLM.
   Nothing is emailed until someone taps Approve.</div>
  <div class="steps">
   <div><b>01</b>Form</div><div><b>02</b>Validate</div><div><b>03</b>CRM repeat check</div>
   <div><b>04</b>Rules + LLM score</div><div><b>05</b>Approve in Telegram</div><div class="g"><b>06</b>Email + CRM</div>
  </div>
  <div class="stats" style="margin-top:auto">
   <div class="stat"><span>Form acknowledged, via a public URL</span><i></i><b>{ack_s:.1f} s</b></div>
   <div class="stat"><span>Scored, drafted, waiting in Telegram</span><i></i><b>{pending_s:.0f} s</b></div>
   <div class="stat"><span>Test scenarios passed, incl. failures</span><i></i><b class="g">{e2e_pass}/{e2e_n}</b></div>
  </div>
 </div>
 <div class="phone" style="align-self:start;margin-top:6px"><div class="scr"><img src="img/telegram-card.png"></div></div>
</div>"""
    css = """
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:26px}
.steps div{border:1px solid var(--rule);background:rgba(255,255,255,.55);padding:9px 11px;font:500 .84rem/1.25 var(--sans);color:var(--ink)}
.steps b{display:block;font:600 .64rem var(--mono);letter-spacing:.1em;color:var(--muted);margin-bottom:3px}
.steps .g{border-color:var(--green);color:var(--green)}.steps .g b{color:var(--green)}
"""
    return page(body, css)


def timeline() -> str:
    lead = {k: lead_field(k) for k in ("name", "company", "budget", "timeline", "message")}
    steps = [
        (clock(t0), "Form posted", f"to the public URL · <b>202</b> in {ack_s:.1f} s"),
        (clock(t_pending), "In Telegram", f"rule {row['rule_score']} · AI {row['ai_fit_score']} · final {row['final_score']} {row['tier']}"),
        (clock(t_replied), "Approved on the phone", "reply emailed, CRM row <b>replied</b>"),
        ("16:02", "Reviewer told", "confirmation in the same chat (phone clock)"),
    ]
    rail = "".join(f'<div class="st"><div class="t">{t}</div><div class="n">{esc(n)}</div><div class="d">{d}</div></div>'
                   for t, n, d in steps)
    form = "".join(f'<div><span>{k}</span> {esc(v)}</div>' for k, v in lead.items())
    body = f"""
<div class="kick">One real lead, end to end</div>
<div class="h" style="font-size:1.9rem">Posted from outside, <em>approved from a phone.</em></div>
<div class="rail">{rail}</div>
<div class="cols">
 <div class="form"><div class="lbl">POST /webhook/lead-intake</div>{form}</div>
 <div class="phone sm"><div class="scr" style="height:396px"><img src="img/telegram-card.png"></div></div>
 <div class="phone sm"><div class="scr" style="height:396px"><img src="img/reply-sent-page.png"></div></div>
 <div class="phone sm"><div class="scr" style="height:396px"><img src="img/telegram-after-approve.png" style="position:absolute;bottom:-4px;left:0;width:125%"></div></div>
</div>
<div class="cap" style="margin-top:12px">Times as on the phone (UTC+4). The lead is synthetic; the bot, the inbox, the sheet and the model are real. Address redacted.</div>"""
    css = """
.rail{display:grid;grid-template-columns:230px repeat(3,1fr);gap:18px;margin-top:20px;border-top:2.5px solid var(--ink);padding-top:10px}
.st .t{font:600 1.05rem var(--mono)}.st .n{font:600 .82rem var(--sans);margin-top:3px}.st .d{font:400 .74rem/1.35 var(--sans);color:var(--ink2);margin-top:2px}
.st .d b{color:var(--green)}
.cols{display:grid;grid-template-columns:230px repeat(3,1fr);gap:18px;margin-top:14px;align-items:start}
.phone.sm{border-radius:18px;padding:6px}.phone.sm .scr{border-radius:13px}
.form{background:#fff;border:1px solid var(--rule);padding:14px;font:400 .74rem/1.45 var(--mono);color:var(--ink2);height:408px;overflow:hidden}
.form .lbl{font-weight:600;color:var(--ink);border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:8px}
.form div{margin-bottom:6px}.form span{color:var(--green);font-weight:500}
"""
    return page(body, css)


def flow() -> str:
    # execution-61.png is 3370x770: row 1 = trigger .. Save to CRM, row 2 = Ask reviewer .. end.
    s = 0.40
    body = f"""
<div class="kick">Execution #61, the live run on the previous image · n8n 2.40.7, self-hosted</div>
<div class="h" style="font-size:1.9rem">26 nodes. <em>The green path is the one it took.</em></div>
<div class="strip" style="width:{1960*s:.0f}px;height:{520*s:.0f}px;margin-top:18px">
 <img src="img/execution-61.png" style="width:{3370*s:.0f}px;margin-top:{-80*s:.0f}px"></div>
<div style="display:grid;grid-template-columns:{1440*s:.0f}px 1fr;gap:26px;margin-top:10px">
 <div class="strip" style="height:{770*s:.0f}px"><img src="img/execution-61.png" style="width:{3370*s:.0f}px;margin-left:{-1930*s:.0f}px"></div>
 <ol class="legend">
  <li><b>Normalize, route</b> invalid → 422 with every error; honeypot → dropped</li>
  <li><b>Find in CRM</b> repeat → counted on the same row, no second approval</li>
  <li><b>Rule score, Ask LLM</b> strict JSON schema, 3 retries; disagreement flagged</li>
  <li><b>Ask reviewer, wait</b> signed Approve / Reject links; 48 h, then expired</li>
  <li><b>Send reply, mark replied</b> only after the click; a second click does not resend</li>
  <li class="err"><b>Error workflow</b> any failure → Telegram alert + errors tab</li>
 </ol>
</div>
"""
    css = """
.strip{overflow:hidden;background:#1e1f21;border-radius:8px;box-shadow:0 14px 30px -18px rgba(21,23,26,.5)}
.strip img{display:block}
.legend{list-style:none;font:400 .74rem/1.32 var(--sans);color:var(--ink2);border-top:2.5px solid var(--ink)}
.legend li{padding:5px 0;border-bottom:1px dashed var(--rule)}
.legend b{display:block;font:600 .72rem var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--green)}
.legend li.err b{color:var(--red)}
"""
    return page(body, css)


def tested() -> str:
    c = checks
    rows = [
        ("Invalid form", "422, all 4 errors listed"),
        ("Spam (honeypot)", "202 like a real lead; no row, no message"),
        ("Approve", "result page, reply emailed, row replied; a second click does not resend"),
        ("Duplicate", "uppercase + +tag variant → same row, counted twice"),
        ("Reject", "no email"),
        ("Prompt injection", f"AI fit {inj_fit}, flagged for review"),
        ("LLM down", f"retried {c['ai-down']['retried 3 times']['detail']} times; saved on the rule score, no draft"),
        ("Nobody clicks", "row expired, no email"),
        ("Mail server down", "no “Reply sent”; error row; alert names the Send reply step"),
        ("CRM step broken", "caller still gets 202; alert names the failing node"),
    ]
    tbl = "".join(f'<div class="r"><span class="ok">pass</span><b>{esc(a)}</b><span>{b}</span></div>' for a, b in rows)
    body = f"""
<div style="display:grid;grid-template-columns:1fr 330px;gap:40px">
 <div>
  <div class="kick">Tested where it breaks</div>
  <div class="h" style="font-size:1.9rem">{e2e_pass} of {e2e_n} scenarios pass. <em>Most of them are failures on purpose.</em></div>
  <div class="tbl">{tbl}</div>
  <div class="cap" style="margin-top:14px">Real n8n, real Google Sheet, real LLM ({esc(E2E['model'])}); Telegram and mail are local mocks in this run. Failures are made by redeploying with a broken setting, not by test switches in the workflow.</div>
 </div>
 <div style="padding-top:26px">
  <div class="lbl">Form message, scenario 6</div>
  <div class="quote">“{esc(inj_msg)}”</div>
  <div class="res"><div><span>AI fit score</span><b>{inj_fit}</b></div><div><span>red flag</span><b style="font-size:.95rem">prompt injection attempt</b></div>
   <div><span>draft</span><b style="font-size:.95rem">no discount promised</b></div></div>
  <div class="note">Known limit: n8n's fixed 250&nbsp;ms regex guard timed out in 2 of 45 executions on the 2-core test laptop. The form retries on 5xx; the README explains the rest.</div>
 </div>
</div>
"""
    css = """
.tbl{margin-top:16px;border-top:2.5px solid var(--ink)}
.tbl .r{display:grid;grid-template-columns:44px 150px 1fr;gap:10px;padding:7.5px 0;border-bottom:1px dashed var(--rule);font:400 .8rem/1.35 var(--sans);color:var(--ink2);align-items:baseline}
.tbl .r b{font-weight:600;color:var(--ink)}
.ok{font:600 .64rem var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--green)}
.lbl{font:500 .68rem var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.quote{font:italic 1.2rem/1.38 var(--serif);color:var(--red);margin-top:10px;padding-left:14px;border-left:3px solid var(--red)}
.res{margin-top:18px;border-top:2.5px solid var(--ink)}
.res div{display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-bottom:1px dashed var(--rule)}
.res span{font:400 .85rem var(--sans);color:var(--ink2)}.res b{font:600 1.5rem var(--mono);color:var(--green)}
.note{margin-top:18px;font:400 .76rem/1.45 var(--sans);color:var(--muted)}
"""
    return page(body, css)


def main() -> None:
    (OUT / "img").mkdir(parents=True, exist_ok=True)
    for f in (ROOT / "docs" / "img").glob("*.png"):
        shutil.copy(f, OUT / "img" / f.name)
    pages = {"01-cover": cover(), "02-one-lead": timeline(), "03-workflow": flow(), "04-tested": tested()}
    for name, doc in pages.items():
        (OUT / f"{name}.html").write_text(doc, encoding="utf-8")
    print(f"{len(pages)} pages → {OUT}")


if __name__ == "__main__":
    main()
