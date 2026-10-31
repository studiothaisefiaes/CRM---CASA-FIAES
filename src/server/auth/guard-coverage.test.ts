import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Esquecer um guarda é falha de segurança: esconder no menu não basta. Este teste lê o código e exige
 * permissão em toda tela de (app), em toda rota /api e em toda server action. Exceção só com motivo, aqui.
 */
const ROOT = join(__dirname, "../../app");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(ROOT);
const rel = (p: string) => relative(ROOT, p);
const src = (p: string) => readFileSync(p, "utf8");
const PAGE_GUARD = /\b(requirePerm|requireAnyPerm)\(/;

/** Telas que só exigem estar logado, com o motivo. */
const PAGE_SESSION_ONLY: Record<string, string> = {
  "(app)/page.tsx": "Hoje: abre para todo mundo; cada bloco aparece só com a permissão do conteúdo",
  "(app)/layout.tsx": "casca (menu, sino): filtra os itens pelas permissões",
};
/** Fora de (app): públicas por natureza. */
const PUBLIC_PAGES = new Set(["layout.tsx", "login/page.tsx", "convite/[token]/page.tsx",
  "imprimir/relatorio/page.tsx", // sem cookie: só abre com token de uso único (5 min) emitido para quem tem "exportar", e os dados seguem as permissões dessa pessoa
  "imprimir/conversa/page.tsx", // token de uso único (5 min) de quem pediu + contatos.ver e relatorios.exportar dessa pessoa
  "imprimir/orcamento/page.tsx", // token de uso único de quem pediu + atendimento.ver dessa pessoa
  "imprimir/avec/page.tsx", // idem, para a tabela de um relatório do Avec: token de uso único + relatorios.ver e relatorios.exportar (ver load.ts)
  "c/[token]/page.tsx", // link da cliente: só o token (32 bytes; no banco, só o hash), mostra o primeiro nome e o horário
  "agendar/page.tsx", // agendamento online: 404 quando desligado; os pedidos guardam o horário e quem confirma é a recepção
]);
/** Rotas que conferem a sessão mas não precisam de permissão (dados da própria pessoa) ou têm outra trava. */
const ROUTE_EXCEPTIONS: Record<string, string> = {
  "api/health/route.ts": "monitor externo: sem dado de cliente",
  "api/versao/route.ts": "só o id do build (aviso de versão nova); passa pelo proxy (exige o cookie de sessão), sem dado de cliente",
  "api/webhooks/evolution/route.ts": "Evolution: segredo do webhook",
  "api/importar/chatguru/route.ts": "ChatGuru (Post para URL): segredo no link; desligada sem CHATGURU_IMPORT_SECRET",
  "api/alertas/route.ts": "alertas da própria pessoa (getMyAlerts já filtra pela permissão de escalada)",
  "api/alertas/atrasados/route.ts": "contador do sino da própria pessoa, no escopo dela",
  "api/stream/route.ts": "tempo real: só avisa que algo mudou, sem dado; a tela recarrega com as próprias permissões",
  "api/stream/poll/route.ts": "o mesmo tempo real do /api/stream por long-polling (túnel/proxy que segura stream); exige sessão",
  "api/sessao/renovar/route.ts": "renova a própria sessão (exige sessão; não devolve dado de cliente)",
  "c/[token]/agenda.ics/route.ts": "calendário da visita: só com o token do link (32 bytes, só o hash no banco), sem o nome da cliente",
  "api/v1/openapi.json/route.ts": "documentação da API v1: só a descrição das rotas (OpenAPI), sem dado nenhum",
};
/**
 * API v1: o route.ts só reexporta o handler de `rotaApi` (src/server/api/rotas/*), que exige a chave, o escopo e a permissão do perfil
 * declarada na rota (`perm`; `perm: null` só com motivo, conferido em src/server/api/api.test.ts).
 */
const API_V1 = /from "@\/server\/api\/rotas\/\w+";\s*$/m;
/** Server actions que só exigem sessão, com o motivo. */
const ACTION_SESSION_ONLY: Record<string, string> = {
  markAlertsReadAction: "marca como lidos os alertas da própria pessoa",
  resolveAlertsAction: "resolve avisos da própria pessoa (e da gestão, para quem recebe escaladas); a espera não",
  completeTaskAction: "conclui uma tarefa (a própria lista de tarefas)",
  setAvailabilityAction: "a própria pessoa muda o próprio estado (disponível, pausa, ausente)",
  savePushSubscriptionAction: "inscreve o aparelho da própria pessoa no push",
  removePushSubscriptionAction: "tira o aparelho da própria pessoa do push",
};
const PUBLIC_ACTION_FILES = new Set(["login/actions.ts", "convite/[token]/actions.ts",
  "c/[token]/actions.ts", // ações do link da cliente: token + limite por IP e por link; a origem do pedido é conferida pelo Next
  "agendar/actions.ts", // pedido do site: limite por IP, isca, tempo mínimo e 2 pedidos abertos por celular
]);

const ancestorsLayouts = (p: string) => {
  const out: string[] = [];
  for (let d = dirname(p); d.startsWith(ROOT) && d !== ROOT; d = dirname(d)) { const l = join(d, "layout.tsx"); if (files.includes(l) && l !== p) out.push(l); }
  return out;
};

describe("todo acesso passa por permissão", () => {
  it("telas: requirePerm na própria tela ou num layout acima", () => {
    const missing = files.filter((p) => /\/(page|layout)\.tsx$/.test(p)).filter((p) => {
      const r = rel(p);
      if (PUBLIC_PAGES.has(r) || PAGE_SESSION_ONLY[r]) return false;
      if (r.startsWith("dev/")) return !PAGE_GUARD.test(src(p)); // ferramenta de teste: também exige permissão
      return ![p, ...ancestorsLayouts(p)].some((f) => PAGE_GUARD.test(src(f)));
    }).map(rel);
    expect(missing).toEqual([]);
  });

  it("rotas /api: assertPerm/can na rota, ou exceção justificada", () => {
    const missing = files.filter((p) => p.endsWith("route.ts")).filter((p) => !ROUTE_EXCEPTIONS[rel(p)] && !(rel(p).startsWith("api/v1/") && API_V1.test(src(p))) && !/\bcan\(user\.perms,|\bcanSeeAvecReports\(user\.perms\)|\bassertPerm\(|\brouteUser\(req, "/.test(src(p))).map(rel);
    expect(missing).toEqual([]);
  });

  it("server actions: cada uma começa por assertPerm/assertAnyPerm (ou só sessão, na lista justificada)", () => {
    const problems: string[] = [];
    for (const p of files.filter((f) => /^"use server"/m.test(src(f)) && !PUBLIC_ACTION_FILES.has(rel(f)))) {
      const code = src(p);
      // export async function X(...) { ... }  e  export const X = async (...) => run(...)
      const fnRe = /export (?:async function (\w+)\s*\(|const (\w+)\s*=\s*async\b)/g;
      const starts = [...code.matchAll(fnRe)].map((m) => ({ name: m[1] ?? m[2], at: m.index! }));
      starts.forEach((s, i) => {
        const body = code.slice(s.at, starts[i + 1]?.at ?? code.length);
        const guarded = /\bassert(Any)?Perm\(/.test(body) || /=>\s*run(Safe)?\(/.test(body);
        const sessionOnly = /\bassertUser\(/.test(body) && ACTION_SESSION_ONLY[s.name];
        if (!guarded && !sessionOnly) problems.push(`${rel(p)}: ${s.name}`);
      });
      // os helpers run/runSafe, se existirem, exigem permissão
      if (/async function run(Safe)?</.test(code) && !/async function run<[^]*?assertPerm\(perm\)/.test(code)) problems.push(`${rel(p)}: run() sem assertPerm`);
    }
    expect(problems).toEqual([]);
  });
});
