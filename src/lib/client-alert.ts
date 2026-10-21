/**
 * Aviso da cliente (Fase C, item 20): o que salta na tela ao abrir o horário ou a comanda. Puro: serve ao servidor e à tela.
 * São os Avisos fixos da ficha (uma linha cada) e, se ela não autorizou, a linha do uso de imagem.
 */
export type ImageUse = "sim" | "nao";
export const IMAGE_USES = ["sim", "nao"] as const;
export const NO_IMAGE_USE_TEXT = "Não autorizou uso de imagem";
export const NO_IMAGE_USE_MAX = 80;

/** Estado do aviso que a tela recebe: se salta e o texto da linha do uso de imagem (já com a configuração e as funções aplicadas). */
export type ClientAlertConfig = { on: boolean; text: string };

/** As linhas do aviso: os avisos fixos sem linha vazia e, se `imageUse === "nao"`, a linha do uso de imagem (texto configurável; vazio = o sugerido). */
export function popupLines(o: { alertNotes: string | null; imageUse: ImageUse | null }, noImageText: string = NO_IMAGE_USE_TEXT): string[] {
  const lines = (o.alertNotes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (o.imageUse === "nao") lines.push(noImageText.trim() || NO_IMAGE_USE_TEXT);
  return lines;
}

/** Chave de "já li" da visita/comanda: texto novo (ou outra visita) dá chave nova e o aviso salta de novo. */
export function alertAckKey(o: { contactId: string; scope: string; lines: string[] }): string {
  return `aviso-cliente:${o.contactId}:${o.scope}:${o.lines.join("␟")}`;
}

/** Como a ficha mostra o uso de imagem: "Sim, desde 12/03/2026" (a data só se houver), "Não" ou "Não informado". */
export function imageUseLabel(use: ImageUse | null | undefined, on: string | null | undefined): string {
  if (use === "nao") return "Não";
  if (use !== "sim") return "Não informado";
  return on ? `Sim, desde ${on.split("-").reverse().join("/")}` : "Sim";
}
