// @vitest-environment jsdom
import { it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

let gesture = false;
class FakeCtx extends EventTarget {
  state: "suspended" | "running" = gesture ? "running" : "suspended";
  currentTime = 0; destination = {};
  async resume() { if (gesture && this.state !== "running") { this.state = "running"; this.dispatchEvent(new Event("statechange")); } }
  createOscillator() { return { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x }; }
}
const g = globalThis as Record<string, unknown>;
beforeEach(() => { gesture = false; g.AudioContext = FakeCtx; (g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); vi.resetModules(); });
afterEach(() => { delete g.AudioContext; document.body.innerHTML = ""; });

async function mount(show: boolean) {
  const { SoundUnlockHint } = await import("./sound-hint");
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<SoundUnlockHint show={show} />); });
  return el;
}

it("com alertas e som bloqueado mostra 'Toque para ativar o som' (botão acessível); o toque libera e o aviso some", async () => {
  const el = await mount(true);
  const btn = el.querySelector("button")!;
  expect(btn).not.toBeNull();
  expect(btn.textContent).toContain("Toque para ativar o som");
  gesture = true;
  await act(async () => { btn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); btn.click(); await new Promise((r) => setTimeout(r, 0)); });
  expect(el.querySelector("button")).toBeNull();
});

it("sem alertas não mostra nada", async () => {
  const el = await mount(false);
  expect(el.querySelector("button")).toBeNull();
});

it("silenciado não mostra nada", async () => {
  localStorage.setItem("cf-silencio-ate", String(Date.now() + 60_000));
  const el = await mount(true);
  expect(el.querySelector("button")).toBeNull();
});
