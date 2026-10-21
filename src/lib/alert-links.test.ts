import { expect, it } from "vitest";
import { alertHref, cancelouAlertKey, folgaAlertKey, onlineAlertKey, remarcarAlertKey } from "./alert-links";

it("aviso com conversa abre a conversa; pedido de folga abre os Pedidos da Agenda", () => {
  expect(alertHref({ type: "sem_resposta_minutos", dealId: "d1", dedupeKey: "x" })).toBe("/atendimento?lead=d1");
  expect(alertHref({ type: "folga_pedida", dealId: null, dedupeKey: folgaAlertKey("b1") })).toBe("/agenda?pedidos=folga");
  expect(alertHref({ type: "whatsapp_desconectado", dealId: null, dedupeKey: "w" })).toBe("/atendimento");
});

it("pediu para remarcar sem conversa abre a ficha da cliente", () => {
  const key = remarcarAlertKey("c1", "l1", new Date("2026-10-15T13:42:10Z"));
  expect(key).toBe("link_remarcar:c1:l1:2026-10-15T13:42");
  expect(alertHref({ type: "link_remarcar", dealId: null, dedupeKey: key })).toBe("/contatos/c1");
  expect(alertHref({ type: "link_remarcar", dealId: null, dedupeKey: remarcarAlertKey(null, "l1", new Date()) })).toBe("/agenda");
});

it("pedido do site abre os Pedidos do site na Agenda", () => {
  expect(onlineAlertKey("v1", "u1")).toBe("online:v1:u1");
  expect(alertHref({ type: "pedido_online", dealId: null, dedupeKey: onlineAlertKey("v1", "u1") })).toBe("/agenda?pedidos=site");
});

it("cancelou pelo link abre o horário cancelado na Agenda, no dia dele", () => {
  expect(cancelouAlertKey("a1", "2026-10-16")).toBe("link_cancelou:a1:2026-10-16");
  expect(alertHref({ type: "link_cancelou", dealId: null, dedupeKey: cancelouAlertKey("a1", "2026-10-16") })).toBe("/agenda?d=2026-10-16&destaque=a1");
});
