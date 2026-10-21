// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/app/(app)/presenca/actions", () => ({ setAvailabilityAction: async () => ({ ok: true, returned: 0 }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { AvailabilityMenu } from "./availability-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ""; });

it("acompanha o estado que vem do servidor (abrir o CRM deixa disponível depois da primeira tela)", async () => {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<AvailabilityMenu initial="ausente" />));
  expect(el.querySelector("button")?.getAttribute("aria-label")).toBe("Meu estado: Ausente");
  await act(async () => root.render(<AvailabilityMenu initial="disponivel" />));
  expect(el.querySelector("button")?.getAttribute("aria-label")).toBe("Meu estado: Disponível");
});
