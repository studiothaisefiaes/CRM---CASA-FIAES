import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { channels } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getShellBanners } from "./banners";

beforeEach(async () => { await resetDb(); });
const now = new Date("2026-10-10T15:00:00Z");
const ch = (name: string, status: "conectado" | "erro" | "desconectado" | "aguardando_qr", quietUntil: Date | null = null) =>
  ({ name, instanceName: `i-${name}`, status, quietUntil });

describe("getShellBanners", () => {
  it("sem canais ou tudo conectado: nenhum banner", async () => {
    expect(await getShellBanners(now)).toEqual({ disconnected: [], quiet: [] });
    await db.insert(channels).values(ch("Salão", "conectado"));
    expect(await getShellBanners(now)).toEqual({ disconnected: [], quiet: [] });
  });
  it("canal em erro ou desconectado avisa; aguardando QR (pareando) e removido não", async () => {
    await db.insert(channels).values([ch("A", "erro"), ch("B", "desconectado"), ch("C", "aguardando_qr"), ch("D (removido)", "desconectado")]);
    const b = await getShellBanners(now);
    expect(b.disconnected.map((c) => c.name).sort()).toEqual(["A", "B"]);
  });
  it("modo quieto só com quiet_until no futuro e canal não removido", async () => {
    const until = new Date(now.getTime() + 3_600_000);
    await db.insert(channels).values([ch("Q", "conectado", until), ch("Velho", "conectado", new Date(now.getTime() - 1000)), ch("X (removido)", "desconectado", until)]);
    const b = await getShellBanners(now);
    expect(b.quiet).toHaveLength(1);
    expect(b.quiet[0]).toMatchObject({ name: "Q", until: until.toISOString() });
  });
});
