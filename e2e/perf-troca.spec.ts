import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { login, e2eSql, isola } from "./helpers";

/**
 * 17/10 (perf-conversa2): trocar entre 5 conversas da Fila. A conversa tem de aparecer COMPLETA (a última mensagem e as fotos da tela)
 * em < 800 ms na primeira vez e < 300 ms quando já está guardada. O e2e roda no servidor de desenvolvimento (mais lento que o build),
 * então os limites têm folga (×3 e ×2) para não ficar instável: o que ele pega é a volta do problema (segundos), não 50 ms a mais.
 * A medida fina, com build de produção e a rede de produção emulada, é `node scripts/perf-conversa.mjs`.
 */
const PREFIXO = "+5571996530";
const LIMITE_PRIMEIRA = 800 * 3;
const LIMITE_GUARDADA = 300 * 2;
const MEDIA = path.join("data", "media");

async function photo(w: number, h: number, seed: number) {
  const raw = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < raw.length; i++) raw[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

/** 5 leads esperando: a maior conversa com 220 mensagens, todas com 2 fotos perto do fim e foto de perfil de 640 px. */
async function semear() {
  await isola(PREFIXO);
  mkdirSync(MEDIA, { recursive: true });
  const [{ id: stage }] = await e2eSql("select id from stages where key = 'lead'");
  const sizes = [220, 120, 60, 30, 12];
  const out: { dealId: string; contactId: string; fim: string }[] = [];
  for (let n = 0; n < sizes.length; n++) {
    const phone = `${PREFIXO}${String(n).padStart(2, "0")}`;
    await e2eSql("delete from messages where contact_id in (select id from contacts where phone_e164 = $1)", [phone]);
    await e2eSql("update deals set archived_at = now() where archived_at is null and contact_id in (select id from contacts where phone_e164 = $1)", [phone]);
    const [c] = await e2eSql("insert into contacts (name, phone_e164) values ($1, $2) on conflict (phone_e164) do update set name = excluded.name returning id", [`Troca Rápida ${n}`, phone]);
    const contactId = String(c.id);
    writeFileSync(path.join(MEDIA, `avatar-${contactId}.jpg`), await photo(640, 640, n + 1));
    await e2eSql("update contacts set avatar_path = $2, avatar_checked_at = now() where id = $1", [contactId, `avatar-${contactId}.jpg`]);
    const [d] = await e2eSql(`insert into deals (contact_id, stage_id, origin, awaiting_reply_since, last_inbound_at, stage_entered_at)
      values ($1, $2, 'whatsapp', now() - interval '${5 + n} minutes', now() - interval '${5 + n} minutes', now()) returning id`, [contactId, stage]);
    const dealId = String(d.id);
    const fim = `Fim da conversa ${n}, até amanhã`;
    for (let k = 0; k < sizes[n]; k++) {
      const at = `${(sizes[n] - k) * 2 + 5 + n} minutes`;
      if (k === sizes[n] - 3 || k === sizes[n] - 5) {
        const [m] = await e2eSql("insert into messages (deal_id, contact_id, direction, kind, status, created_at) values ($1, $2, 'in', 'image', 'received', now() - $3::interval) returning id", [dealId, contactId, at]);
        writeFileSync(path.join(MEDIA, `${m.id}.jpg`), await photo(1280, 960, k + 100 * n));
        await e2eSql("update messages set media_path = $2 where id = $1", [m.id, `${m.id}.jpg`]);
      } else {
        const last = k === sizes[n] - 1;
        await e2eSql("insert into messages (deal_id, contact_id, direction, kind, body, status, created_at) values ($1, $2, $3, 'text', $4, $5, now() - $6::interval)",
          [dealId, contactId, last || k % 3 ? "in" : "out", last ? fim : `Mensagem ${k}: queria saber o preço da escova e se tem horário sábado`, last || k % 3 ? "received" : "sent", at]);
      }
    }
    out.push({ dealId, contactId, fim });
  }
  return out;
}

test("trocar entre 5 conversas: completa em < 800 ms na primeira vez e < 300 ms guardada (com folga do dev server)", async ({ page, isMobile }) => {
  test.skip(isMobile, "Fila de três colunas do computador");
  test.setTimeout(180_000);
  const conversas = await semear();
  await login(page);
  // Aquece o dev server (compila a página e as rotas da conversa, da foto e da mídia) numa conversa que não entra na conta.
  await page.goto(`/atendimento?view=todos&lead=${conversas[4].dealId}`);
  await expect(page.getByRole("log", { name: "Mensagens" }).getByText(conversas[4].fim)).toBeVisible({ timeout: 60_000 });
  await page.goto("/atendimento?view=todos");
  await expect(page.locator(`[role="option"][data-deal-id="${conversas[0].dealId}"]`)).toBeVisible();

  const completa = (fim: string) => page.evaluate((fim) => {
    const log = document.querySelector('[role="log"][aria-label="Mensagens"]');
    if (!log?.textContent?.includes(fim)) return false;
    const box = log.getBoundingClientRect();
    const onScreen = [...log.querySelectorAll("img")].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom >= box.top && r.top <= box.bottom; });
    return onScreen.length > 0 && onScreen.every((i) => i.complete && i.naturalWidth > 0);
  }, fim);
  // Aquece também o caminho do clique na lista (pré-busca, "lido", miniaturas) com a mesma conversa de fora da conta.
  await page.locator(`[role="option"][data-deal-id="${conversas[4].dealId}"]`).click();
  await expect.poll(() => completa(conversas[4].fim), { timeout: 60_000 }).toBe(true);
  const tempos: Record<1 | 2, number[]> = { 1: [], 2: [] };
  for (const volta of [1, 2] as const) {
    for (const c of conversas.slice(0, 4)) {
      const item = page.locator(`[role="option"][data-deal-id="${c.dealId}"]`);
      await item.scrollIntoViewIfNeeded();
      const t0 = Date.now();
      await item.click();
      await expect.poll(() => completa(c.fim), { timeout: 15_000, intervals: [10] }).toBe(true);
      tempos[volta].push(Date.now() - t0);
      await page.waitForTimeout(300);
    }
  }
  const mediana = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log(`[perf-troca] 1ª volta ${tempos[1].join(", ")} ms · guardada ${tempos[2].join(", ")} ms`);
  expect(Math.max(...tempos[1]), `1ª volta: ${tempos[1].join(", ")} ms`).toBeLessThan(LIMITE_PRIMEIRA);
  expect(mediana(tempos[2]), `guardada: ${tempos[2].join(", ")} ms`).toBeLessThan(LIMITE_GUARDADA);

  // A foto da Fila é a miniatura WebP pequena (o original tem ~100 KB), e a foto da conversa também.
  const foto = await page.request.get(`/api/avatar/${conversas[0].contactId}?v=1`);
  expect(foto.headers()["content-type"]).toBe("image/webp");
  expect((await foto.body()).length).toBeLessThan(10_000);
  expect(foto.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
  const src = await page.getByRole("log", { name: "Mensagens" }).locator("img").first().getAttribute("src");
  expect(src).toMatch(/\/api\/media\/[\w-]+\?thumb=1$/);
  const img = await page.request.get(src!);
  expect(img.headers()["content-type"]).toBe("image/webp");
});
