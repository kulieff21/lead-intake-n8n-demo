// Dev-only stand-ins for the Telegram Bot API, an SMTP server and a failing LLM endpoint.
// Used by tools/e2e.mjs before the real bot and mailbox exist; the live run (PLAN 5.16) uses
// the real services. Nothing here is referenced by the workflow itself, only by deploy config.
import http from 'node:http';
import net from 'node:net';

export function startMocks({ httpPort = 8081, smtpPort = 2525 } = {}) {
  const telegram = [];
  const mails = [];
  const aiCalls = [];

  const web = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const tg = req.url.match(/^\/bot([^/]+)\/(\w+)/);
      if (tg) {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch { payload = Object.fromEntries(new URLSearchParams(body)); }
        telegram.push({ method: tg[2], payload, at: Date.now() });
        return send(200, { ok: true, result: { message_id: telegram.length, date: Math.floor(Date.now() / 1000), chat: { id: Number(payload.chat_id) || 0, type: 'private' }, text: payload.text ?? '' } });
      }
      if (req.url.startsWith('/ai-down/')) { aiCalls.push(Date.now()); return send(503, { error: { message: 'mock: upstream unavailable' } }); }
      send(404, { ok: false });
    });
  });
  web.listen(httpPort, '127.0.0.1');

  // Minimal SMTP: enough of RFC 5321 for nodemailer (EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA).
  const smtp = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    let authStep = 0;
    let msg = { from: '', to: [], data: '' };
    const w = (s) => sock.write(`${s}\r\n`);
    w('220 mock ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; mails.push({ ...msg, at: Date.now() }); msg = { from: '', to: [], data: '' }; w('250 OK queued'); }
          else msg.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        if (authStep) { authStep = authStep === 1 ? (w('334 UGFzc3dvcmQ6'), 2) : (w('235 OK'), 0); continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') { w('250-mock'); w('250 AUTH PLAIN LOGIN'); }
        else if (line.toUpperCase().startsWith('AUTH PLAIN')) w('235 OK');
        else if (line.toUpperCase().startsWith('AUTH LOGIN')) { w('334 VXNlcm5hbWU6'); authStep = 1; }
        else if (cmd === 'MAIL') { msg.from = line.slice(10).trim(); w('250 OK'); }
        else if (cmd === 'RCPT') { msg.to.push(line.slice(8).trim()); w('250 OK'); }
        else if (cmd === 'DATA') { inData = true; w('354 go'); }
        else if (cmd === 'QUIT') { w('221 bye'); sock.end(); }
        else w('250 OK');
      }
    });
    sock.on('error', () => {});
  });
  smtp.listen(smtpPort, '127.0.0.1');

  return {
    telegram, mails, aiCalls,
    close: () => Promise.all([new Promise((r) => web.close(r)), new Promise((r) => smtp.close(r))]),
  };
}
