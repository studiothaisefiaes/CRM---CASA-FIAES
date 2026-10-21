// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DemoBadge } from "./demo-badge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ""; });

it("mostra a etiqueta Demonstração e explica que os dados são fictícios", async () => {
  const el = document.createElement("div"); document.body.appendChild(el);
  await act(async () => createRoot(el).render(<DemoBadge />));
  expect(el.textContent).toBe("Demonstração");
  expect(el.querySelector("[title]")?.getAttribute("title")).toMatch(/fictícios/);
});
