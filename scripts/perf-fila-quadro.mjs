// Medição de tarefas longas (> 50 ms) na Fila e no Quadro, com build de PRODUÇÃO, CPU 4x e 100 leads.
// Uso: node scripts/perf-fila-quadro.mjs   (precisa do Postgres no ar; usa SEMPRE o banco crm_e2e)
// Passos: zera e semeia crm_e2e -> next build (NEXT_DIST_DIR=.next-perf) -> next start numa porta livre -> Playwright + CDP -> encerra o servidor.
import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import pg from "pg";

const PORT = Number(process.env.PERF_PORT ?? 3190);
const DB = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_e2e$1");
if (!DB.includes("crm_e2e")) throw new Error("só roda no banco crm_e2e");
const env = { ...process.env, DATABASE_URL: DB, NEXT_DIST_DIR: ".next-perf", APP_URL: `http://localhost:${PORT}`, PORT: String(PORT) };
const N = 100, SECONDS = 10, CPU = 4;

execSync("npx tsx e2e/reset.ts", { env, stdio: "inherit" });
const c = new pg.Client({ connectionString: DB }); await c.connect();
const stages = Object.fromEntries((await c.query("select key, id from stages")).rows.map((r) => [r.key, r.id]));
const plan = [["lead", 50], ["atendimento", 30], ["followup_1", 10], ["agendado", 10]];
let n = 0;
for (const [key, qty] of plan) for (let i = 0; i < qty; i++, n++) {
  const phone = `+55719970${String(n).padStart(5, "0")}`;
  const mins = 1 + ((n * 7) % 119); // de 1 a 119 min de espera: de "dentro do prazo" a muito atrasado
  const ct = (await c.query("insert into contacts (name, phone_e164) values ($1,$2) returning id", [`Cliente Perf ${n}`, phone])).rows[0].id;
  const d = (await c.query("insert into deals (contact_id, stage_id, origin, awaiting_reply_since, last_inbound_at, stage_entered_at) values ($1,$2,'whatsapp', now() - ($3 || ' minutes')::interval, now() - ($3 || ' minutes')::interval, now() - ($3 || ' minutes')::interval) returning id", [ct, stages[key], String(mins)])).rows[0].id;
  await c.query("insert into messages (deal_id, contact_id, direction, kind, body, status, created_at) values ($1,$2,'in','text',$3,'received', now() - ($4 || ' minutes')::interval)", [d, ct, `Oi, queria saber o preço ${n}`, String(mins)]);
}
await c.end();
console.log(`semeados ${n} leads em crm_e2e`);

execSync("npx next build", { env, stdio: "inherit" });
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", detached: false });
const stop = () => { try { server.kill("SIGTERM"); } catch {} try { execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null || true`); } catch {} };
process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(1); });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Bahia" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/login`);
  await page.getByLabel("E-mail").fill("gestao@e2e.local"); await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Entrar" }).click(); await page.waitForURL(`http://localhost:${PORT}/`);
  await page.addInitScript(() => {
    window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch {}
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  // Controle: o observador tem de enxergar uma tarefa longa de verdade (bloqueio de 120 ms).
  await page.goto(`http://localhost:${PORT}/atendimento?view=todos`); await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__lt.length = 0; setTimeout(() => { const t = performance.now(); while (performance.now() - t < 120); }, 0); });
  await page.waitForTimeout(500);
  const controle = await page.evaluate(() => window.__lt.length);
  console.log(`controle (bloqueio de 120 ms): ${controle} tarefa(s) longa(s) vista(s)`);
  const out = {};
  for (const [name, path, ready] of [["Fila", "/atendimento?view=todos", '[role="option"]'], ["Quadro", "/funil", '[role="listitem"]']]) {
    await page.goto(`http://localhost:${PORT}${path}`); await page.waitForSelector(ready);
    const items = await page.locator(ready).count();
    await page.waitForTimeout(3000); // regime: passada a hidratação e as animações de entrada
    await page.evaluate(() => { window.__lt.length = 0; });
    const m0 = await cdp.send("Performance.getMetrics").catch(() => null);
    await page.waitForTimeout(SECONDS * 1000);
    const lt = await page.evaluate(() => window.__lt.slice());
    out[name] = { itens: items, tarefasLongas: lt.length, duracoesMs: lt.map((x) => x[1]), porSegundo: +(lt.length / SECONDS).toFixed(2) };
  }
  console.log("RESULTADO " + JSON.stringify({ cpu: `${CPU}x`, janelaSegundos: SECONDS, leads: N, ...out }, null, 1));
  await browser.close();
} finally { stop(); }
