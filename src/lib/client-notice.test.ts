import { expect, it } from "vitest";
import { clientNotice } from "./client-notice";

const id = "6f1c2c1e-3b1a-4c55-9a51-0d3c1b2a4e10";

it("mensagem da cliente com aviso vira notificação do sistema com o texto, o link da conversa e a mesma etiqueta do push (não duplica)", () => {
  expect(clientNotice({ type: "mensagem_recebida", dealId: id, aviso: true, texto: "Maria escreveu: “oi”" }))
    .toEqual({ title: "Mensagem de cliente", body: "Maria escreveu: “oi”", url: `/atendimento?lead=${id}`, tag: `/atendimento?lead=${id}` });
  expect(clientNotice({ type: "lead_criado", dealId: id, aviso: true, texto: "Número novo escreveu: “oi”" })?.body).toBe("Número novo escreveu: “oi”");
});

it("sem aviso (mensagem velha, reação, envio da Casa) ou sem texto: nada", () => {
  expect(clientNotice({ type: "mensagem_recebida", dealId: id })).toBeNull();
  expect(clientNotice({ type: "mensagem_recebida", dealId: id, aviso: true })).toBeNull();
  expect(clientNotice({ type: "mensagem_enviada", dealId: id, aviso: true, texto: "x" })).toBeNull();
  expect(clientNotice({ type: "alerta", dealId: id, aviso: true, texto: "x" })).toBeNull();
});
