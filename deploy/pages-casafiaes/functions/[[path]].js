// Casa Fiaes: este endereço só redireciona para o CRM oficial no servidor da Casa (Contabo).
// Antes era um proxy, mas cada pedido ganhava 250–350 ms (e picos de segundos) no desvio pela Cloudflare. Redirecionado, tudo vai direto.
// 302 (temporário) de propósito: quando crm.casafiaes.com.br existir, é só trocar o TARGET.
const TARGET = "https://crm.217-76-54-18.sslip.io";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  return Response.redirect(TARGET + url.pathname + url.search, 302);
}
