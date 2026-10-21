"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveVirada, sendViradaTest } from "@/server/domain/virada";
import { getLembreteD1 } from "@/server/domain/client-link/settings";
import { saveLembreteD1 } from "@/server/domain/client-link/reminder";
import { getAfterVisit, saveAfterVisit } from "@/server/domain/after-visit";

type R = { ok: true } | { ok: false; error: string };
const alvoSchema = z.enum(["lembrete", "depois"], { message: "Troca desconhecida." });
const modoSchema = z.enum(["agradecimento", "pesquisa"], { message: "Escolha o agradecimento ou a Pesquisa de satisfação." });
const fail = (e: unknown) => ({ ok: false as const, error: userErrorMessage(e, "virada") });
const done = () => { revalidatePath("/config/virada"); };

/** Marca ou desmarca os passos da troca do ChatGuru para o CRM. Exige `virada.fazer` no servidor. */
export async function saveViradaAction(alvo: unknown, marcados: unknown): Promise<R> {
  try {
    const u = await assertPerm("virada.fazer");
    await saveVirada(alvoSchema.parse(alvo), z.array(z.string().max(40)).max(10).parse(marcados), u.id);
    done();
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Manda o texto de verdade para o WhatsApp digitado (número novo ou de Equipe; de cliente ou fornecedor é recusado). Exige `virada.fazer`. */
export async function sendViradaTestAction(alvo: unknown, phone: unknown, modo?: unknown): Promise<R> {
  try {
    const u = await assertPerm("virada.fazer");
    const a = alvoSchema.parse(alvo);
    await sendViradaTest(a, z.string().max(40).parse(phone), u.id, { modo: modo === undefined ? undefined : modoSchema.parse(modo) });
    done();
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * O último passo: liga o lembrete (`enabled`) ou o Depois do atendimento (`mode`) com a configuração gravada. Exige `virada.fazer`;
 * o servidor confere o checklist, o teste e `confirmouEnvio` (o aviso de envio real da tela).
 */
export async function ligarViradaAction(alvo: unknown, opts: { confirmouEnvio?: boolean; modo?: unknown } = {}): Promise<R> {
  try {
    const u = await assertPerm("virada.fazer");
    const a = alvoSchema.parse(alvo);
    const confirmouEnvio = opts.confirmouEnvio === true;
    if (a === "lembrete") await saveLembreteD1({ ...(await getLembreteD1()), enabled: true }, u.id, { confirmouEnvio });
    else await saveAfterVisit({ ...(await getAfterVisit()), mode: modoSchema.parse(opts.modo) }, u.id, { confirmouEnvio });
    done();
    revalidatePath(a === "lembrete" ? "/config/automacoes" : "/config/depois-atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}
