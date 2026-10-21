import { it, expect, describe } from "vitest";
import { z } from "zod";
import { GENERIC_ERROR, userErrorMessage } from "./user-error";
import { UserFacingError } from "./domain/errors";
import { SendError } from "./domain/send";
import { ProviderError } from "./whatsapp/provider";

const quiet = <T>(fn: () => T) => { const errs: unknown[][] = []; const o = console.error; console.error = (...a: unknown[]) => { errs.push(a); }; try { return { r: fn(), errs }; } finally { console.error = o; } };

describe("userErrorMessage: o que pode aparecer na tela", () => {
  it("erro de SQL do drizzle/pg vira texto genérico e vai para o log", () => {
    class DrizzleQueryError extends Error { constructor(public query: string, public cause: Error) { super(`Failed query: ${query}`); } }
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "lists_kind_label_uq"'), { code: "23505" });
    for (const e of [new DrizzleQueryError("insert into lists ...", pg), pg]) {
      const { r, errs } = quiet(() => userErrorMessage(e, "teste"));
      expect(r).toBe(GENERIC_ERROR);
      expect(errs.length).toBe(1);
    }
    expect(GENERIC_ERROR).toBe("Não deu certo. Tente de novo.");
  });
  it("erros de programação (TypeError etc.) também viram genérico", () => {
    expect(quiet(() => userErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), "t")).r).toBe(GENERIC_ERROR);
    expect(quiet(() => userErrorMessage("string solta", "t")).r).toBe(GENERIC_ERROR);
  });
  it("erros do domínio (texto fixo em pt-BR) passam como estão", () => {
    expect(userErrorMessage(new Error("Só a gestão pode fazer isso."), "t")).toBe("Só a gestão pode fazer isso.");
    expect(userErrorMessage(new UserFacingError("Informe o valor da venda."), "t")).toBe("Informe o valor da venda.");
    expect(userErrorMessage(new SendError("Escreva uma mensagem antes de enviar."), "t")).toBe("Escreva uma mensagem antes de enviar.");
    expect(userErrorMessage(new ProviderError("O serviço do WhatsApp (Evolution) não respondeu. Ele está ligado?"), "t")).toMatch(/Evolution/);
  });
  it("zod: a mensagem da regra (a primeira)", () => {
    const r = z.object({ n: z.number().min(1, "O mínimo é 1 por hora.") }).safeParse({ n: 0 });
    expect(userErrorMessage(r.error, "t")).toBe("O mínimo é 1 por hora.");
  });
});
