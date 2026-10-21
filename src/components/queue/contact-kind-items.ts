import type { MenuItem } from "@/components/ui/menu";
import { CONTACT_KINDS, KIND_HINT, KIND_LABEL, type ContactKind } from "@/lib/contact-kind";

/** As opções no ⋯ da conversa: "Marcar como …" para cada tipo que não é o atual (o mesmo do botão direito na Fila). */
export function kindMenuItems(current: ContactKind, onPick: (k: ContactKind) => void): MenuItem[] {
  return CONTACT_KINDS.filter((k) => k !== current).map((k) => ({ label: `Marcar como ${KIND_LABEL[k].toLowerCase()}`, detail: KIND_HINT[k], danger: k === "spam", onSelect: () => onPick(k) }));
}
