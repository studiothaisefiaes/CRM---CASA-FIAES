import { and, desc, eq, lt, ne, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CONTACT_KINDS } from "@/lib/contact-kind";
import { birthdayLabel } from "@/lib/birthday";
import { IMAGE_USES } from "@/lib/client-alert";
import { db } from "../../db";
import { contacts } from "../../db/schema";
import { createClient, DuplicatePhoneError } from "../../domain/new-client";
import { updateContactProfile } from "../../domain/contact-profile";
import { tagsOf } from "../../domain/tags";
import { ApiErro, lerCursor, pagina, rotaApi, zId, zInstanteSaida, zLista, zPaginacao, zUm, zUuid } from "../rota";
import { buscaContato, telefoneDe, zInstanteOuNulo } from "./comum";

/**
 * Contatos (Clientes) pela API. Ler: contatos.ver (como a tela, sem escopo por pessoa). Cadastrar e editar: contatos.editar, pelas mesmas
 * funções da tela (createClient e updateContactProfile: grava só o que mudou e audita por campo). O CPF não sai nem entra pela API
 * (regra da Casa: CPF nunca vai para serviço de fora).
 */
const GRUPO = "Contatos";

const zContato = z.object({
  id: z.uuid(),
  nome: z.string().nullable(),
  apelido: z.string().nullable().meta({ description: "Como gosta de ser chamada." }),
  telefone: z.string().nullable().meta({ description: "WhatsApp em E.164; null para pessoa no mesmo número de outra (veja `mesmo_numero_de`) ou número oculto." }),
  outro_telefone: z.string().nullable(),
  email: z.string().nullable(),
  instagram: z.string().nullable(),
  aniversario: z.string().nullable().meta({ description: "dd/mm ou dd/mm/aaaa." }),
  tipo: z.enum(CONTACT_KINDS),
  cliente: z.boolean().meta({ description: "Já foi atendida (virou cliente)." }),
  cliente_desde: zInstanteOuNulo,
  ultimo_servico_em: zInstanteOuNulo,
  tipo_cabelo: z.string().nullable(),
  observacoes: z.string().nullable(),
  avisos: z.string().nullable().meta({ description: "Avisos fixos (alergia, cuidados): um por linha." }),
  profissional_preferida_id: z.uuid().nullable(),
  uso_de_imagem: z.enum(IMAGE_USES).nullable(),
  mesmo_numero_de: z.uuid().nullable().meta({ description: "Pessoa a mais no número de outra cliente (filha, mãe…): o id da titular." }),
  etiquetas: z.array(z.string()),
  criado_em: zInstanteSaida,
});

type Row = typeof contacts.$inferSelect;
const contatoDe = (c: Row, etiquetas: string[]) => ({
  id: c.id, nome: c.name, apelido: c.nickname, telefone: telefoneDe(c.phoneE164), outro_telefone: c.phoneAlt, email: c.email, instagram: c.instagram,
  aniversario: birthdayLabel(c.birthDay, c.birthMonth, c.birthYear), tipo: c.kind, cliente: c.isClient, cliente_desde: c.clientSince, ultimo_servico_em: c.lastServiceAt,
  tipo_cabelo: c.hairType, observacoes: c.notes, avisos: c.alertNotes, profissional_preferida_id: c.preferredProfessionalId, uso_de_imagem: c.imageUse,
  mesmo_numero_de: c.sharesPhoneWith, etiquetas, criado_em: c.createdAt,
});
async function comEtiquetas(rows: Row[]) {
  const tags = await tagsOf(rows.map((r) => r.id));
  return rows.map((r) => contatoDe(r, (tags.get(r.id) ?? []).map((t) => t.name)));
}
async function contatoPorId(id: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!c) throw new ApiErro(404, "Esse contato não existe.");
  return (await comEtiquetas([c]))[0];
}

export const listarContatos = rotaApi({
  metodo: "GET", caminho: "/contatos", escopo: "ler", perm: "contatos.ver", grupo: GRUPO,
  resumo: "Lista e busca contatos",
  descricao: "Do cadastro mais novo para o mais velho. `q` busca por nome ou telefone (qualquer formato: com ou sem +55, DDD, máscara, o 9). Os marcados como Spam (\"Não é cliente\") só vêm com `tipo=spam`.",
  query: z.object({
    q: z.string().trim().min(1).max(80).optional(),
    tipo: z.enum(CONTACT_KINDS).optional().meta({ description: "cliente, equipe, fornecedor ou spam." }),
    ...zPaginacao,
  }),
  resposta: zLista(zContato),
  handler: async ({ query }) => {
    const conds: (SQL | undefined)[] = [query.tipo ? eq(contacts.kind, query.tipo) : ne(contacts.kind, "spam")];
    if (query.q) conds.push(buscaContato(query.q));
    const c = lerCursor(query.cursor);
    if (c) conds.push(or(lt(contacts.createdAt, c.em), and(eq(contacts.createdAt, c.em), lt(contacts.id, c.id))));
    const rows = await db.select().from(contacts).where(and(...conds)).orderBy(desc(contacts.createdAt), desc(contacts.id)).limit(query.limite + 1);
    const p = pagina(rows, query.limite, (r) => ({ em: r.createdAt, id: r.id }));
    return { dados: await comEtiquetas(p.dados), proximo_cursor: p.proximo_cursor };
  },
});

export const verContato = rotaApi({
  metodo: "GET", caminho: "/contatos/{id}", escopo: "ler", perm: "contatos.ver", grupo: GRUPO,
  resumo: "Um contato", params: zId, resposta: zUm(zContato),
  handler: async ({ params }) => ({ dados: await contatoPorId(params.id) }),
});

const zAniversario = z.string().trim().regex(/^\d{1,2}\/\d{1,2}(\/\d{4})?$/, "Use dia/mês ou dia/mês/ano, ex.: 14/11 ou 14/11/1990.");

export const criarContato = rotaApi({
  metodo: "POST", caminho: "/contatos", escopo: "escrever", perm: "contatos.editar", grupo: GRUPO, status: 201,
  resumo: "Cadastra cliente nova",
  descricao: "O mesmo \"Nova cliente\" da tela: nome e telefone obrigatórios. Não abre conversa nem manda nada. Telefone que já existe (com ou sem o 9) dá 409 com o id da ficha que já existe.",
  corpo: z.object({ nome: z.string().trim().min(2).max(120), telefone: z.string().trim().min(1).max(40), email: z.email().max(200).optional(), aniversario: zAniversario.optional() }),
  resposta: zUm(zContato),
  handler: async ({ user, body, alvo }) => {
    try {
      const r = await createClient({ name: body.nome, phone: body.telefone, email: body.email ?? "", birthday: body.aniversario ?? "" }, user.id);
      alvo(r.contactId);
      return { dados: await contatoPorId(r.contactId) };
    } catch (e) {
      if (e instanceof DuplicatePhoneError) throw new ApiErro(409, `${e.message} (id: ${e.existing.id})`);
      throw e;
    }
  },
});

export const alterarContato = rotaApi({
  metodo: "PATCH", caminho: "/contatos/{id}", escopo: "escrever", perm: "contatos.editar", grupo: GRUPO,
  resumo: "Edita a ficha",
  descricao: "Grava só o que mudou (auditado por campo), como a ficha da tela. Texto vazio ou null apaga o campo. `uso_de_imagem` pede a permissão \"Mudar o uso de imagem da cliente\" e a função ligada.",
  params: zId,
  corpo: z.object({
    nome: z.string().max(120).nullable().optional(),
    apelido: z.string().max(60).nullable().optional(),
    telefone: z.string().max(30).nullable().optional().meta({ description: "O WhatsApp da cliente. Número de outra ficha dá 409 (use Unir cadastros na tela)." }),
    outro_telefone: z.string().max(30).nullable().optional(),
    email: z.union([z.email(), z.literal(""), z.null()]).optional(),
    instagram: z.string().max(60).nullable().optional(),
    aniversario: z.union([zAniversario, z.literal(""), z.null()]).optional(),
    tipo_cabelo: z.string().max(120).nullable().optional(),
    observacoes: z.string().max(4000).nullable().optional(),
    avisos: z.string().max(300).nullable().optional(),
    profissional_preferida_id: z.union([zUuid, z.null()]).optional(),
    uso_de_imagem: z.enum(IMAGE_USES).nullable().optional(),
  }).strict(),
  resposta: zUm(zContato.extend({ alterados: z.array(z.string()) })),
  handler: async ({ user, params, body, alvo }) => {
    alvo(params.id);
    const r = await updateContactProfile(params.id, {
      name: body.nome, nickname: body.apelido, phone: body.telefone, phoneAlt: body.outro_telefone, email: body.email, instagram: body.instagram,
      birthday: body.aniversario, hairType: body.tipo_cabelo, notes: body.observacoes, alertNotes: body.avisos, preferredProfessionalId: body.profissional_preferida_id,
      imageUse: body.uso_de_imagem,
    }, user.id, user.perms).catch((e: unknown) => {
      if (e instanceof Error && /já é de outra cliente/.test(e.message)) throw new ApiErro(409, e.message);
      throw e;
    });
    return { dados: { ...(await contatoPorId(params.id)), alterados: r.changed } };
  },
});
