import type { DuplicateSignal } from "@/server/queries/duplicate-suspects";

export const SIGNAL_LABEL: Record<DuplicateSignal, string> = {
  cpf: "mesmo CPF", email: "mesmo e-mail", aniversario: "mesmo aniversário", final8: "mesmo final de telefone",
  pessoa_a_mais: "pessoa a mais com cadastro próprio", codigo_avec: "mesmo código do Avec",
};
