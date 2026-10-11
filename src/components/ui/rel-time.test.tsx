// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { RelTime } from "./rel-time";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

it("o servidor diz 'há 3 minutos' e o navegador já está em 'há 4': a hidratação não quebra", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const at = new Date("2026-10-10T12:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at.getTime() + 3 * 60_000 + 29_000); // "há 3 minutos" no servidor
  const container = document.createElement("div");
  container.innerHTML = renderToString(<p>alterada <RelTime at={at.toISOString()} /></p>);
  document.body.appendChild(container);
  expect(container.textContent).toContain("há 3 minutos");
  vi.setSystemTime(at.getTime() + 3 * 60_000 + 31_000); // "há 4 minutos" no navegador
  const errors: unknown[] = [];
  await act(async () => { hydrateRoot(container, <p>alterada <RelTime at={at.toISOString()} /></p>, { onRecoverableError: (e) => errors.push(e) }); });
  expect(errors).toEqual([]);
});
