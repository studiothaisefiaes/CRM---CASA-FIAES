import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { listServicesPage } from "@/server/domain/services";
import { listPackageCards } from "@/server/domain/caixa/packages";
import { ServicesPage } from "@/components/servicos/services-page";
import { listPaymentOptions } from "@/server/domain/caixa/payment-options";
import { PaymentOptionsEditor } from "@/components/servicos/payment-options";
import { LoyaltyPrograms } from "@/components/servicos/loyalty-programs";
import { getAvecLoyaltyProgramId, listLoyaltyPrograms } from "@/server/domain/fidelidade-programas";
import { isFuncaoOn } from "@/server/domain/funcoes";
import { ProductsTab } from "@/components/servicos/products-tab";
import { getEstoqueConfig } from "@/server/domain/estoque/config";
import { listProducts } from "@/server/domain/estoque/produtos";
import { redirect } from "next/navigation";
import { firstAllowedPath } from "@/lib/permissions";
import { SERVICOS_PERMS, servicosView } from "@/lib/servicos-tabs";
import { CardFeesEditor } from "@/components/servicos/card-fees";
import { listPaymentFees } from "@/server/domain/caixa/payment-fees";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";

export const metadata = { title: "Serviços e pacotes" };

/**
 * Serviços (pedido do dono, 16/10): serviços e pacotes numa tela só. ?aba=pacotes (catálogo; ?pacote= abre o painel) ·
 * ?aba=clientes (o andamento de cada cliente, antiga /pacotes: ?situacao=, ?q=, ?pacote= filtra pelo pacote do catálogo).
 * Gestão e recepção mudam; a atendente consulta.
 */
export default async function ServicosPage({ searchParams }: PageProps<"/servicos">) {
  // Quem só cuida do estoque (estoque.produtos ou estoque.movimentar) também entra, e vê só a aba Produtos (M-5).
  const user = await requireAnyPerm(...SERVICOS_PERMS);
  const sp = await searchParams;
  // "Clientes com pacote" saiu daqui: agora é Clientes › Com pacote (o endereço antigo, com os filtros, leva para lá).
  if (sp.aba === "clientes" && can(user.perms, "contatos.ver") && can(user.perms, "atendimento.ver")) {
    const q = new URLSearchParams({ vista: "pacote" });
    for (const k of ["situacao", "q", "pacote"]) { const v = sp[k]; if (typeof v === "string" && v) q.set(k, v); }
    redirect(`/contatos?${q}`);
  }
  const canFormas = can(user.perms, "caixa.gerir");
  // Produtos: a aba só existe com Produtos e estoque ligado, para quem vê o catálogo (atendimento.ver) ou mexe nele.
  const canProdutos = can(user.perms, "atendimento.ver") || can(user.perms, "estoque.produtos") || can(user.perms, "estoque.movimentar");
  const estoqueCfg = canProdutos ? await getEstoqueConfig() : null;
  const estoqueOn = !!estoqueCfg?.ligado;
  const view = servicosView(user.perms, { aba: sp.aba, estoqueOn });
  if (!view) redirect(`${firstAllowedPath(user.perms)}?aviso=sem-permissao`);
  const { tab, soProdutos } = view;
  const now = new Date();
  // 0084: o custo só sai do banco para quem tem servicos.custo; os campos novos da ficha seguem as permissões e as funções ligadas.
  const canCost = can(user.perms, "servicos.custo");
  const [precoPorPro, juntoComOutro] = await Promise.all([isFuncaoOn("preco_por_profissional"), isFuncaoOn("junto_com_outro")]);
  const sheetOpts = { canCost, canProTerms: can(user.perms, "servicos.por_profissional"), precoPorPro, juntoComOutro };
  // Só estoque: nada de serviços, preços e pacotes vai para a tela.
  const [{ services, professionals }, packages] = soProdutos ? [{ services: [], professionals: [] }, []] : await Promise.all([listServicesPage({ withCost: canCost }), listPackageCards(now)]);
  const open = typeof sp.servico === "string" ? sp.servico : null;
  const pacoteParam = typeof sp.pacote === "string" && isUuid(sp.pacote) ? sp.pacote : null;
  // A aba aparece para quem gere o caixa; o conteúdo só é buscado nela.
  // As taxas aparecem com o recurso ligado; quem vê a aba sem "Mudar as taxas do cartão" só lê.
  const formas = canFormas ? (tab === "formas" ? await formasTab(can(user.perms, "caixa.taxas")) : <></>) : undefined;
  const fidelidade = tab === "fidelidade" ? await loyaltyTab(services, can(user.perms, "fidelidade.programas")) : undefined;
  const produtos = estoqueOn ? (tab === "produtos" ? <ProductsTab rows={await listProducts()} can={{ produtos: can(user.perms, "estoque.produtos"), movimentar: can(user.perms, "estoque.movimentar") }}
    padrao={estoqueCfg ? { cfop: estoqueCfg.cfopPadrao, csosn: estoqueCfg.csosnPadrao } : undefined} /> : <></>) : undefined;
  // Trocar de aba ou abrir pelo link (?servico=, ?pacote=) na mesma rota: monta de novo para o painel abrir.
  return <ServicesPage key={`${tab}|${open ?? ""}|${tab === "pacotes" ? pacoteParam ?? "" : ""}`} tab={tab} services={services} packages={packages} professionals={professionals} canEdit={can(user.perms, "servicos.editar")} 
    initialOpen={open} initialPackage={tab === "pacotes" ? pacoteParam : null} formas={soProdutos ? undefined : formas} fidelidade={fidelidade} produtos={produtos} soProdutos={soProdutos} sheetOpts={sheetOpts} />;
}

/** Fidelidade: os programas da Casa. Sem a função ligada a aba mostra o aviso; sem fidelidade.programas é só consulta. */
async function loyaltyTab(services: { id: string; label: string; active: boolean }[], canEdit: boolean) {
  const [programs, avecProgramId, funcaoOn] = await Promise.all([listLoyaltyPrograms(), getAvecLoyaltyProgramId(), isFuncaoOn("fidelidade")]);
  return (
    <LoyaltyPrograms funcaoOn={funcaoOn} canEdit={canEdit} avecProgramId={avecProgramId} services={services.filter((s) => s.active).map((s) => ({ id: s.id, label: s.label }))}
      programs={programs.map((p) => ({ id: p.id, name: p.name, description: p.description, kind: p.kind, goal: p.goal, countsServiceIds: p.countsServiceIds, rewardServiceIds: p.rewardServiceIds,
        rewardDiscountBp: p.rewardDiscountBp, maxDiscountBp: p.maxDiscountBp, countsPackageSessions: p.countsPackageSessions, rewardReasonTemplate: p.rewardReasonTemplate, active: p.active }))} />
  );
}


/** Aba Formas de pagamento: a "Outra forma" e, abaixo, as taxas do cartão (se o recurso estiver ligado em Configurações › Caixa). */
async function formasTab(canTaxas: boolean) {
  const [options, fees, recursos] = await Promise.all([listPaymentOptions(), listPaymentFees(), getCaixaRecursos()]);
  return (
    <div className="flex flex-col gap-8">
      <PaymentOptionsEditor options={options.map((o) => ({ id: o.id, label: o.label, active: o.active }))} />
      {recursos.taxaCartao && <CardFeesEditor canEdit={canTaxas} fees={fees.map((f) => ({ method: f.method as "credito" | "debito", brand: f.brand, parcelado: f.parcelado, feeBp: f.feeBp }))} />}
    </div>
  );
}
