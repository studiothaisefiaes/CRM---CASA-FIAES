import { displayName } from "./display-name";

/**
 * Profissional assistente (17/10: SIDNEY é assistente de THAISE). Para a cliente quem atende é a principal (o servidor já troca o nome
 * no que ela vê); dentro do CRM a equipe vê os dois: "Sidney (assistente de Thaise)".
 */
export const teamProLabel = (name: string, principal: string | null | undefined) =>
  principal ? `${displayName(name)} (assistente de ${displayName(principal)})` : displayName(name);
