// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

let path = "/agenda";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
let { useSidebarCollapsed } = await import("./sidebar-state");

beforeEach(async () => { localStorage.clear(); vi.resetModules(); ({ useSidebarCollapsed } = await import("./sidebar-state")); });
afterEach(() => { path = "/agenda"; });

it("fora do Atendimento o menu nasce aberto e dá para encolher; a escolha fica guardada e não mexe no Atendimento", () => {
  const { result, rerender } = renderHook(() => useSidebarCollapsed());
  expect(result.current).toMatchObject({ collapsed: false, workspace: false });
  act(() => result.current.toggle());
  expect(result.current.collapsed).toBe(true);
  expect(localStorage.getItem("crm-menu-encolhido-nas-telas")).toBe("1");
  path = "/atendimento"; rerender();
  expect(result.current).toMatchObject({ collapsed: true, workspace: true }); // o Atendimento segue a regra dele (nasce encolhido)
  act(() => result.current.toggle());
  expect(result.current.collapsed).toBe(false);
  path = "/contatos"; rerender();
  expect(result.current.collapsed).toBe(true);
});

it("sem armazenamento (navegação privada) funciona só na hora, sem quebrar", () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
  const { result } = renderHook(() => useSidebarCollapsed());
  expect(() => act(() => result.current.toggle())).not.toThrow();
  expect(result.current.collapsed).toBe(true);
  spy.mockRestore();
});

it("nasce encolhido só nas telas de Conversas (Fila e Quadro); a Jornada agora é de Relatórios", async () => {
  const { isWorkspacePath } = await import("./sidebar-state");
  expect(isWorkspacePath("/atendimento")).toBe(true);
  expect(isWorkspacePath("/atendimento/programadas")).toBe(true);
  expect(isWorkspacePath("/funil")).toBe(true);
  expect(isWorkspacePath("/jornada")).toBe(false);
});
