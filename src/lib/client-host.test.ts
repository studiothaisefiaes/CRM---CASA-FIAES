import { describe, expect, it } from "vitest";
import { clientHostAllows, clientLinkBase, clientOnlyHost, onClientHost } from "./client-host";

const CRM = "https://crm.217-76-54-18.sslip.io";
const AGENDA = "https://agenda.casafiaes.com.br";

describe("domínio dos links da cliente", () => {
  it("com CLIENT_LINK_URL os links usam ele; sem ele, o APP_URL (nada muda)", () => {
    expect(clientLinkBase({ APP_URL: CRM, CLIENT_LINK_URL: `${AGENDA}/` })).toBe(AGENDA);
    expect(clientLinkBase({ APP_URL: CRM })).toBe(CRM);
    expect(clientLinkBase({ APP_URL: CRM, CLIENT_LINK_URL: "" })).toBe(CRM);
  });

  it("host só da cliente: o de CLIENT_LINK_URL, e só se for outro que não o do CRM", () => {
    expect(clientOnlyHost({ APP_URL: CRM, CLIENT_LINK_URL: AGENDA })).toBe("agenda.casafiaes.com.br");
    expect(clientOnlyHost({ APP_URL: CRM })).toBeNull();
    expect(clientOnlyHost({ APP_URL: CRM, CLIENT_LINK_URL: CRM })).toBeNull();
  });

  it("nesse host só /c/..., o agendamento online (/agendar) e os arquivos do Next", () => {
    for (const p of ["/c/K7mPq2Xa", "/c/K7mPq2Xa/agenda.ics", "/c/marca.png", "/_next/static/chunks/a.js", "/agendar"]) expect(clientHostAllows(p)).toBe(true);
    for (const p of ["/", "/login", "/c", "/agenda", "/api/health", "/api/webhooks/evolution", "/convite/x", "/agendarx", "/agendar/../login", "/manifest.webmanifest", "/__nextjs_font"]) expect(clientHostAllows(p)).toBe(false);
    expect(clientHostAllows("/__nextjs_original-stack-frame", true)).toBe(true);
  });

  it("onClientHost compara o Host do pedido (sem diferença de maiúscula)", () => {
    const src = { APP_URL: CRM, CLIENT_LINK_URL: AGENDA };
    expect(onClientHost(new Headers({ host: "AGENDA.casafiaes.com.br" }), src)).toBe(true);
    expect(onClientHost(new Headers({ host: "crm.217-76-54-18.sslip.io" }), src)).toBe(false);
    expect(onClientHost(new Headers({ host: "agenda.casafiaes.com.br" }), { APP_URL: CRM })).toBe(false);
  });
});
