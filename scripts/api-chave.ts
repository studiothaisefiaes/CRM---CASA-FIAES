import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { apiKeys, users } from "../src/server/db/schema";
import { criarChave, ESCOPOS, listarChaves, revogarChave, type Escopo } from "../src/server/api/chaves";

/**
 * Chaves da API pelo terminal do servidor (o mesmo que Configurações › API faz, para quando não dá para abrir a tela).
 *   npx tsx scripts/api-chave.ts criar --nome "Planilha" --email pessoa@casa --escopos ler,escrever [--vale-ate 2026-12-31]
 *   npx tsx scripts/api-chave.ts listar
 *   npx tsx scripts/api-chave.ts revogar <id ou prefixo cf_xxxxx>
 * A chave aparece UMA vez, na criação (o banco guarda só o hash). Fica na auditoria sem autor (feito pelo terminal).
 * O terminal do servidor é o administrador: escolhe a pessoa livremente (na tela, em nome de outra pessoa só a Gestão; ver criarChave).
 */
const arg = (a: string[], k: string) => { const i = a.indexOf(`--${k}`); return i > -1 ? a[i + 1] : undefined; };
const USO = "Uso: api-chave.ts criar --nome <nome> --email <email da pessoa> --escopos ler,escrever,enviar [--vale-ate AAAA-MM-DD] | listar | revogar <id ou prefixo>";

export async function apiChave(a: string[], out: (s: string) => void = console.log): Promise<void> {
  const [cmd] = a;
  if (cmd === "criar") {
    const nome = arg(a, "nome"), email = arg(a, "email"), escopos = (arg(a, "escopos") ?? "").split(",").map((s) => s.trim()).filter(Boolean), vale = arg(a, "vale-ate");
    if (!nome || !email || !escopos.length) throw new Error(USO);
    const ruins = escopos.filter((e) => !(ESCOPOS as readonly string[]).includes(e));
    if (ruins.length) throw new Error(`Escopo desconhecido: ${ruins.join(", ")} (use ${ESCOPOS.join(", ")}).`);
    if (vale && !/^\d{4}-\d{2}-\d{2}$/.test(vale)) throw new Error("--vale-ate: use AAAA-MM-DD.");
    const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(sql`lower(${users.email}) = lower(${email})`);
    if (!u) throw new Error(`Ninguém da equipe com o e-mail ${email}.`);
    const expiraEm = vale ? new Date(new Date(`${vale}T00:00:00-03:00`).getTime() + 86_400_000) : null;
    const r = await criarChave({ nome, userId: u.id, escopos: escopos as Escopo[], expiraEm }, null);
    out(`Chave "${nome}" criada em nome de ${u.name} (${escopos.join(", ")}${vale ? `, vale até ${vale}` : ""}).`);
    out(`Guarde agora, ela não aparece de novo:\n${r.chave}`);
    return;
  }
  if (cmd === "listar") {
    const lista = await listarChaves();
    if (!lista.length) { out("Nenhuma chave."); return; }
    for (const c of lista) {
      out([c.id, `${c.prefixo}…`, c.nome, c.userName, c.escopos.join(","), c.situacao, `último uso: ${c.ultimoUso?.toISOString() ?? "nunca"}`].join("  |  "));
    }
    return;
  }
  if (cmd === "revogar") {
    const alvo = a[1];
    if (!alvo) throw new Error(USO);
    const achadas = /^[0-9a-f-]{36}$/i.test(alvo)
      ? await db.select({ id: apiKeys.id, nome: apiKeys.name }).from(apiKeys).where(eq(apiKeys.id, alvo))
      : await db.select({ id: apiKeys.id, nome: apiKeys.name }).from(apiKeys).where(sql`${apiKeys.prefix} = ${alvo.replace(/…$/, "").slice(0, 8)}`);
    if (achadas.length !== 1) throw new Error(achadas.length ? "Mais de uma chave com esse prefixo: use o id (veja listar)." : "Chave não encontrada.");
    const r = await revogarChave(achadas[0].id, null);
    out(r.revogada ? `Chave "${achadas[0].nome}" revogada.` : `Chave "${achadas[0].nome}" já estava revogada.`);
    return;
  }
  throw new Error(USO);
}

if (process.argv[1] && /api-chave\.ts$/.test(process.argv[1])) {
  apiChave(process.argv.slice(2)).then(() => pool.end()).catch((e: Error) => { console.error(e.message); process.exit(1); });
}
