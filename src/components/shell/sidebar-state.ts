"use client";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

/**
 * Menu lateral recolhível (só ícones) em todas as telas. Nas telas de trabalho de Conversas (Fila, Quadro, Programadas) ele nasce encolhido,
 * para sobrar espaço para a conversa; nas outras nasce aberto. Cada uma guarda a última escolha neste navegador ("Abrir menu"/"Encolher menu"):
 * quem encolheu na Agenda continua com ele encolhido nas outras telas, sem mexer no Atendimento.
 */
const KEY = "crm-menu-aberto-no-atendimento";
const KEY_OTHERS = "crm-menu-encolhido-nas-telas";
const listeners = new Set<() => void>();
// A escolha desta aba (vale mesmo sem armazenamento, ex. navegação privada); o localStorage guarda para as próximas vezes.
const mem = new Map<string, boolean>();
const get = (k: string) => { if (mem.has(k)) return mem.get(k)!; try { return localStorage.getItem(k) === "1"; } catch { return false; } };
/** Instantâneo primitivo (o useSyncExternalStore compara por valor): "aberto no Atendimento|encolhido nas outras". */
const read = () => `${get(KEY) ? 1 : 0}|${get(KEY_OTHERS) ? 1 : 0}`;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === KEY_OTHERS) { mem.delete(e.key); fn(); } };
  addEventListener("storage", onStorage);
  return () => { listeners.delete(fn); removeEventListener("storage", onStorage); };
};
const save = (k: string, on: boolean) => {
  mem.set(k, on);
  try { localStorage.setItem(k, on ? "1" : "0"); } catch { /* sem armazenamento: vale só agora */ }
  listeners.forEach((fn) => fn());
};

export function setMenuOpenOnWorkspace(open: boolean) { save(KEY, open); }
/** Nas telas fora do Atendimento: `collapsed` = encolhido. */
export function setMenuCollapsedElsewhere(collapsed: boolean) { save(KEY_OTHERS, collapsed); }

export const isWorkspacePath = (path: string | null) => !!path && /^\/(atendimento|funil)(\/|$)/.test(path);

/** `collapsed`: o menu está encolhido agora; `workspace`: estamos numa tela do Atendimento; `toggle`: abre/encolhe e guarda a escolha desta tela. */
export function useSidebarCollapsed(): { collapsed: boolean; workspace: boolean; toggle: () => void } {
  const path = usePathname();
  const [wsOpen, othersCollapsed] = useSyncExternalStore(subscribe, read, () => "0|0").split("|").map((x) => x === "1");
  const workspace = isWorkspacePath(path);
  const collapsed = workspace ? !wsOpen : othersCollapsed;
  const toggle = () => (workspace ? setMenuOpenOnWorkspace(collapsed) : setMenuCollapsedElsewhere(!collapsed));
  return { collapsed, workspace, toggle };
}
