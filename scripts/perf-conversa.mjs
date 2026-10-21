// Medição da Fila e da troca de conversa com volume parecido com o de produção (17/10: 220 leads abertos, 158 fotos de perfil,
// ~9 mil mensagens, a maior conversa com 539, fotos de ~50 KB e imagens de ~140 KB), build de PRODUÇÃO e rede parecida com a
// medida do Mac até o servidor (ida e volta ~230 ms, ~120 KB/s).
// Uso: node scripts/perf-conversa.mjs [--sem-build] [--rede=prod|livre]
//   Banco: PERF_DB (padrão: o do .env com o nome trocado por crm_perf2). Recusa qualquer banco que não seja crm_perf* ou crm_e2e*.
//   Porta: PERF_PORT (padrão 3531). Recusa as portas do dev do usuário. Evolution: endereço morto (nunca a real).
// Saída: uma linha "RESULTADO {json}" com as medidas.
import "dotenv/config";
import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

const PORT = Number(process.env.PERF_PORT ?? 3531);
if ([3000, 3100, 4321, 4400, 8080].includes(PORT)) throw new Error(`PERF_PORT ${PORT} é reservada; use outra (padrão 3531).`);
const base = new URL(process.env.DATABASE_URL ?? "");
const DB = process.env.PERF_DB ?? (base.pathname = "/crm_perf2", base.toString());
if (!/\/crm_(perf|e2e)[\w]*(\?|$)/.test(DB)) throw new Error("só roda num banco crm_perf* ou crm_e2e*");
const args = process.argv.slice(2);
const BUILD = !args.includes("--sem-build");
/** Só mede (o banco já semeado e o build pronto): para medir a mesma base nas duas redes. */
const SO_MEDIR = args.includes("--so-medir");
const REDE = (args.find((a) => a.startsWith("--rede="))?.split("=")[1]) ?? "prod";
const MEDIA_DIR = path.join(os.tmpdir(), "crm-perf-media");
const env = { ...process.env, DATABASE_URL: DB, NEXT_DIST_DIR: ".next-perf", APP_URL: `http://localhost:${PORT}`, PORT: String(PORT),
  EVOLUTION_URL: "http://127.0.0.1:9", MEDIA_DIR, DEV_TOOLS: "false", TZ: "America/Bahia" };

// ---------- dados ----------
function noiseJpeg(w, h, noise, q, seed) {
  const buf = Buffer.alloc(w * h * 3);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    buf[i] = (x * 255 / w + rnd() * noise) | 0; buf[i + 1] = (y * 255 / h + rnd() * noise) | 0; buf[i + 2] = (((x + y + seed) % 256) + rnd() * noise) | 0;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer();
}

async function seedData() {
  execSync("npx tsx e2e/reset.ts", { env, stdio: "inherit" });
  mkdirSync(MEDIA_DIR, { recursive: true });
  const c = new pg.Client({ connectionString: DB }); await c.connect();
  const stages = Object.fromEntries((await c.query("select key, id from stages")).rows.map((r) => [r.key, r.id]));
  const plan = [["lead", 110], ["atendimento", 60], ["followup_1", 30], ["agendado", 20]];
  // As 5 conversas da troca: tamanhos das maiores de produção, 8 imagens cada (as últimas perto do fim).
  // Ficam no meio da lista (posições 100–104): fora da pré-busca das primeiras da Fila, como uma conversa qualquer.
  const big = [539, 268, 232, 120, 60], BIG_AT = 100;
  const avatarBytes = [], mediaBytes = [];
  const measured = [];
  let n = 0, msgs = 0;
  for (const [key, qty] of plan) for (let i = 0; i < qty; i++, n++) {
    const phone = `+55719980${String(n).padStart(5, "0")}`;
    const mins = 1 + ((n * 7) % 119);
    const ct = (await c.query("insert into contacts (name, phone_e164) values ($1,$2) returning id", [`Cliente Perf ${n}`, phone])).rows[0].id;
    if (n % 220 < 158) { // 158 de 220 com foto, como em produção
      const jpg = await noiseJpeg(640, 640, 8 + (n % 5) * 6, 78, n + 1);
      avatarBytes.push(jpg.length);
      writeFileSync(path.join(MEDIA_DIR, `avatar-${ct}.jpg`), jpg);
      await c.query("update contacts set avatar_path = $1, avatar_checked_at = now() - interval '1 day' where id = $2", [`avatar-${ct}.jpg`, ct]);
    }
    const d = (await c.query("insert into deals (contact_id, stage_id, origin, awaiting_reply_since, last_inbound_at, stage_entered_at) values ($1,$2,'whatsapp', now() - ($3 || ' minutes')::interval, now() - ($3 || ' minutes')::interval, now() - ($3 || ' minutes')::interval) returning id",
      [ct, stages[key], String(mins)])).rows[0].id;
    const isBig = n >= BIG_AT && n < BIG_AT + big.length;
    const count = isBig ? big[n - BIG_AT] : 3 + (n % 40);
    const imgsAt = isBig ? new Set([2, 5, 9, 14, 20, 27, 33, 38].map((k) => count - k)) : new Set();
    for (let k = 0; k < count; k++) {
      const at = `${mins + (count - k) * 3} minutes`;
      const dir = k % 3 === 0 ? "out" : "in";
      if (imgsAt.has(k)) {
        const r = await c.query("insert into messages (deal_id, contact_id, direction, kind, body, status, created_at, media_mime) values ($1,$2,'in','image',null,'received', now() - $3::interval, 'image/jpeg') returning id", [d, ct, at]);
        const jpg = await noiseJpeg(1280, 960, 10 + (k % 4) * 4, 78, k + n * 1000);
        mediaBytes.push(jpg.length);
        writeFileSync(path.join(MEDIA_DIR, `${r.rows[0].id}.jpg`), jpg);
        await c.query("update messages set media_path = $1 where id = $2", [`${r.rows[0].id}.jpg`, r.rows[0].id]);
      } else {
        const body = k === count - 1 ? `FIM-${n}` : `Mensagem ${k} da conversa ${n}: ${dir === "in" ? "oi, queria saber o preço da escova e se tem horário sábado" : "Bom dia! Temos sim, posso te mandar os horários?"}`;
        await c.query("insert into messages (deal_id, contact_id, direction, kind, body, status, created_at) values ($1,$2,$3,'text',$4,$5, now() - $6::interval)",
          [d, ct, k === count - 1 ? "in" : dir, body, dir === "in" || k === count - 1 ? "received" : "sent", at]);
      }
      msgs++;
    }
    if (isBig) measured.push({ dealId: d, n, count });
  }
  // Contatos sem lead (a base de produção tem ~6 mil).
  await c.query(`insert into contacts (name, phone_e164) select 'Base ' || g, '+5571997' || lpad(g::text, 6, '0') from generate_series(1, 6000) g`);
  await c.end();
  const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / Math.max(1, a.length));
  console.log(`semeados ${n} leads, ${msgs} mensagens, ${avatarBytes.length} fotos (média ${avg(avatarBytes)} B), ${mediaBytes.length} imagens (média ${avg(mediaBytes)} B)`);
  return { measured, avatarAvg: avg(avatarBytes), mediaAvg: avg(mediaBytes) };
}

async function measuredFromDb() {
  const c = new pg.Client({ connectionString: DB }); await c.connect();
  const { rows } = await c.query(`select d.id, ct.name, (select count(*)::int from messages m where m.deal_id = d.id) n from deals d join contacts ct on ct.id = d.contact_id
    where ct.name in ('Cliente Perf 100','Cliente Perf 101','Cliente Perf 102','Cliente Perf 103','Cliente Perf 104') order by ct.name`);
  await c.end();
  return { measured: rows.map((r) => ({ dealId: r.id, n: Number(r.name.split(" ").at(-1)), count: r.n })), avatarAvg: null, mediaAvg: null };
}

// ---------- medição ----------
const REDES = {
  // Medido do Mac em 17/10: ping 227–560 ms, ~100–120 KB/s de download.
  prod: { offline: false, latency: 230, downloadThroughput: 120 * 1024, uploadThroughput: 60 * 1024 },
  livre: null,
};

async function measure(info) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Bahia" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/login`);
  await page.getByLabel("E-mail").fill("gestao@e2e.local"); await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Entrar" }).click(); await page.waitForURL(`http://localhost:${PORT}/`);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (REDES[REDE]) await cdp.send("Network.emulateNetworkConditions", REDES[REDE]);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });

  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp }));
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.t1 = e.timestamp; r.bytes = e.encodedDataLength; } });
  cdp.on("Network.requestServedFromCache", (e) => { const r = reqs.get(e.requestId); if (r) r.cache = true; });
  const done = (re) => [...reqs.values()].filter((r) => re.test(r.url) && r.t1);
  const stats = (rs) => {
    const ms = rs.map((r) => Math.round((r.t1 - r.t0) * 1000)).sort((a, b) => a - b);
    const q = (p) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null;
    return { n: rs.length, bytes: rs.reduce((s, r) => s + (r.bytes ?? 0), 0), p50: q(0.5), p90: q(0.9), max: ms.at(-1) ?? null };
  };

  // Fila: até a lista aparecer e 6 s depois (fotos).
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/atendimento?view=todos`, { waitUntil: "commit" });
  await page.waitForSelector('[role="option"]');
  const filaMs = Date.now() - t0;
  await page.waitForTimeout(6000);
  const filaAvatares = stats(done(/\/api\/avatar\//));

  // Troca entre as 5 conversas (2 voltas: a 2ª já com elas guardadas no navegador).
  const isComplete = async (n) => page.evaluate((fim) => {
    const log = document.querySelector('[role="log"][aria-label="Mensagens"]');
    if (!log || !log.textContent?.includes(fim)) return false;
    // Todas têm imagens perto do fim: completa = ao menos uma imagem na tela e todas as da tela carregadas.
    const box = log.getBoundingClientRect();
    const onScreen = [...log.querySelectorAll("img")].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom >= box.top && r.top <= box.bottom; });
    return onScreen.length > 0 && onScreen.every((i) => i.complete && i.naturalWidth > 0);
  }, `FIM-${n}`);
  const isVisible = async (n) => page.evaluate((fim) => !!document.querySelector('[role="log"][aria-label="Mensagens"]')?.textContent?.includes(fim), `FIM-${n}`);
  const troca = [];
  for (const volta of [1, 2]) {
    for (const m of info.measured) {
      const item = page.locator(`[role="option"][data-deal-id="${m.dealId}"]`);
      await item.scrollIntoViewIfNeeded();
      const start = Date.now();
      await item.click();
      let visivel = null, completa = null, retried = false;
      while (Date.now() - start < 20_000) {
        // A lista pode reordenar entre o scroll e o clique (lido, tempo real): sem a conversa em 5 s, clica de novo.
        if (visivel === null && !retried && Date.now() - start > 5000) { retried = true; await item.click(); }
        if (visivel === null && await isVisible(m.n)) visivel = Date.now() - start;
        if (visivel !== null && await isComplete(m.n)) { completa = Date.now() - start; break; }
        await page.waitForTimeout(15);
      }
      troca.push({ volta, mensagens: m.count, visivelMs: visivel, completaMs: completa, ...(retried ? { reclicou: true } : {}) });
      await page.waitForTimeout(400);
    }
  }
  // Tamanho do JSON da maior conversa e se veio comprimido.
  const conversaJson = await page.evaluate(async (id) => { const r = await fetch(`/api/conversa/${id}`); const t = await r.text(); return { chars: t.length, encoding: r.headers.get("content-encoding") }; }, info.measured[0].dealId);
  const midia = stats(done(/\/api\/media\//));
  const avatares = stats(done(/\/api\/avatar\//));
  const conversa = stats(done(/\/api\/conversa\/[^/]+$/));
  await browser.close();
  return { rede: REDE, conversaJson, filaMs, filaAvatares, avatares, midia, conversaApi: conversa, troca };
}

// ---------- roda ----------
const info = SO_MEDIR ? await measuredFromDb() : await seedData();
if (BUILD && !SO_MEDIR) execSync("npx next build", { env, stdio: "inherit" });
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch {} };
process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(1); });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  const out = await measure(info);
  console.log("RESULTADO " + JSON.stringify({ fotoMediaBytes: info.avatarAvg, imagemMediaBytes: info.mediaAvg, ...out }));
} finally { stop(); }
