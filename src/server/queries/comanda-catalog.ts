import { can, type Perm } from "@/lib/permissions";
import { displayName } from "@/lib/display-name";
import type { ComandaCatalog } from "@/components/caixa/comanda-sheet";
import { listProfessionals } from "../domain/professionals";
import { getCaixaMode } from "../domain/caixa/mode";
import { listPackageDefs } from "../domain/caixa/packages";
import { getEstoqueConfig } from "../domain/estoque/config";
import { listProducts } from "../domain/estoque/produtos";
import { listBookableServices } from "./agenda";
import { clientAlertFor } from "../domain/client-alert";

/**
 * A fonte ÚNICA do catálogo da comanda (serviços, profissionais, pacotes e, com Produtos e estoque ligado, os produtos de venda).
 * Toda porta que abre a comanda (Hoje, Caixa, Agenda, Ao vivo, Fechar o dia) monta por aqui; sem os produtos, "Produto" vira texto livre.
 * Não confere permissão nem modo do caixa: quem chama já decidiu que a comanda abre.
 */
export async function buildComandaCatalog(user: { perms: readonly Perm[] }, extra: { today?: string; paymentOptions?: { id: string; label: string }[] } = {}): Promise<ComandaCatalog> {
  const [services, pros, packages, estoque, clientAlert] = await Promise.all([listBookableServices(), listProfessionals(), listPackageDefs({ activeOnly: true }), getEstoqueConfig(), clientAlertFor("comanda")]);
  const products = estoque.ligado ? (await listProducts({ activeOnly: true })).filter((p) => p.use === "venda") : [];
  return {
    services: services.map((x) => ({ id: x.id, label: x.label })),
    professionals: pros.map((p) => ({ id: p.id, name: displayName(p.name), active: p.active, assistantOf: p.assistantOf })),
    packageDefs: packages.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents })), canGerir: can(user.perms, "caixa.gerir"), canAssistente: can(user.perms, "caixa.assistente"), canDivida: can(user.perms, "caixa.divida"), canCancelar: can(user.perms, "caixa.cancelar"),
    clientAlert, canRedeemLoyalty: can(user.perms, "fidelidade.resgatar"),
    estoqueLigado: estoque.ligado, products: products.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, barcode: p.barcode, stockQty: p.stockQty })),
    ...(extra.today ? { today: extra.today } : {}), ...(extra.paymentOptions ? { paymentOptions: extra.paymentOptions } : {}),
  };
}

/**
 * O catálogo da comanda grande (Receber e Abrir comanda fora da Agenda, como no Hoje): só com o caixa no CRM e para quem tem
 * `caixa.operar`; null fora disso (quem usa esconde Receber).
 */
export async function getComandaCatalog(user: { id: string; perms: readonly Perm[] }): Promise<ComandaCatalog | null> {
  if (!can(user.perms, "caixa.operar") || (await getCaixaMode()) !== "crm") return null;
  return buildComandaCatalog(user);
}
