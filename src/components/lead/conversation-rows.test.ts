import { it, expect } from "vitest";
import { withDays } from "./conversation";

const m = (id: string, direction: "in" | "out", at: string, sender: string | null = null) =>
  ({ id, direction, kind: "text", body: id, status: "sent", createdAt: at, sender, fromPhone: false });

it("mensagens seguidas da mesma pessoa em até 5 min se agrupam; mudou de lado, de pessoa, de dia ou passou o tempo, começa outro grupo", () => {
  const rows = withDays([
    m("a", "in", "2026-10-14T12:00:00Z"),
    m("b", "in", "2026-10-14T12:03:00Z"),          // mesmo grupo
    m("c", "out", "2026-10-14T12:04:00Z", "Ana"),  // outro lado
    m("d", "out", "2026-10-14T12:05:00Z", "Bia"),  // outra atendente
    m("e", "out", "2026-10-14T12:06:00Z", "Bia"),  // mesmo grupo
    m("f", "out", "2026-10-14T12:20:00Z", "Bia"),  // passou 5 min
    m("g", "out", "2026-10-15T12:21:00Z", "Bia"),  // outro dia
  ]);
  expect(rows.map((r) => r.cont)).toEqual([false, true, false, false, true, false, false]);
  expect(rows[6].day).not.toBeNull();
});
