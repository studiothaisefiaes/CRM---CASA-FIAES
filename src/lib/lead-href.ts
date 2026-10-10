/** Único lugar que sabe para onde "abrir o lead" aponta: a Fila. No celular, /atendimento?lead=ID leva a /atendimento/ID. */
export const leadHref = (dealId: string | null | undefined) => (dealId ? `/atendimento?lead=${dealId}` : "/atendimento");
