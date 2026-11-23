// Minimal CDP helper: node cdp.js <urlSubstr> <jsFile|-> [port]
const fs = require("fs");
const PORT = process.argv[4] || 9222;
const SUB = process.argv[2] || "gemini.google.com";
const jsArg = process.argv[3] || "-";
const expr = jsArg === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(jsArg, "utf8");

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => (x.url || "").includes(SUB)) || list[0];
  if (!t) { console.error("no target"); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Runtime.enable", {});
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
    timeout: 20000,
  });
  const out = r.result && r.result.value !== undefined ? r.result.value : r;
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });