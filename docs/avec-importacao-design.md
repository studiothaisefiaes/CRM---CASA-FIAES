# Juntar o Avec no CRM: agenda própria, pacotes, histórico e relatórios

Pedido do Joaquim (14/10): "organizar agendamentos, horários de cada pessoa ou serviço, cadastrar os clientes, pacotes, datas de quando vai fazer, tudo". A Casa mandou ~227 relatórios .xlsx do Avec (205 formatos; catálogo de cabeçalhos em `docs/avec-formatos.json`, chave = assinatura). Os arquivos ficam FORA do repo (`~/Projects/casa-fiaes/dados-avec/originais`) porque têm CPF/RG/endereço/banco.

Atenção: a maioria dos relatórios cobre só 01/10 a 14/10/2026 (período padrão do Avec). Reservas futuras vão até 19/12/2026, pacotes até 2027, financeiro desde 12/2025. Histórico maior depende de a Casa exportar de novo com período longo, e a tela de upload resolve isso.

## Regras que não mudam

- Nunca guardar CPF, RG, CEP, endereço (Endereço/Número de endereço/Complemento/Bairro/Cidade/Estado), banco/agência/conta. Saneia ANTES de gravar qualquer coisa, inclusive na tabela crua do relatório.
- Nunca inventar dado: o que não veio fica vazio ("não informado"), nada de preço/duração chutados.
- Importação idempotente: rodar duas vezes o mesmo arquivo, ou dois relatórios que trazem a mesma reserva/venda, não duplica (chave externa determinística, upsert completando campos vazios).
- Nada é enviado no WhatsApp por causa da importação. Importar não mexe em leads/etapas/Fila.

## Formato dos arquivos

- 1ª planilha, linha 1 = cabeçalho, sem linhas de título. Datas "dd/mm/aaaa" (string), hora "HH:MM", dinheiro em REAIS como número (150 = R$ 150,00; guardar em centavos), telefone como número (71990000001 → +55…, usar `normalizePhone` de `src/server/domain/phone.ts`).
- Nome da cliente pode vir com sufixo de observação entre parênteses: "Úrsula Duarte Abreu (T. USO DE IMAGEM)". Para casar com contato, comparar sem o parêntese final; o sufixo "USO DE IMAGEM" vira a etiqueta "Uso de imagem" na cliente.
- Profissional: na agenda vem o apelido ("MAIARA"), na comanda o nome completo ("MAIARA DA SILVA SANTANA"). O relatório de profissionais (`cdc646d8`: ID, Nome, Cargo, CPF, Apelido, Especialidade…) liga os dois. Cadastrar profissional pelo apelido (nome de tela), guardando nome completo e cargo; nunca CPF/banco.
- Cliente sem telefone na linha: casar por nome normalizado (sem acento, minúsculas, sem parêntese, espaços únicos) com contato existente SÓ se houver exatamente um; senão guarda `client_name` sem contato.

## Formatos e para onde vão

| Assinatura | O que é | Destino |
|---|---|---|
| dc841e71, 7737c39e, 4cad067e, fb0490d0, 4c9ce320, 0d541ef1, fb8e34ba, 9bec623d, 5d0fefc2, ae14ff16, cc013749, 862b213d, 9897d129, 63d414a7, f18900ac, e8aa4978, fbd442b2, 0c96c703 (+ qualquer formato com coluna de telefone/celular e nome) | listas de clientes / linhas com nome+telefone | contatos: upsert por telefone (cria se não existe; completa nome/e-mail/aniversário/última visita vazios; `is_client=true` se aparece em comanda/reserva/visita) |
| f18900ac, 1903eedc, e51ff131 | reservas (agenda) | `appointments` (status do Avec mapeado) |
| e8aa4978 | cancelamentos | `appointments` status `cancelado` |
| fbd442b2 | lista de espera (Data, Cliente, Telefone, Profissional, Serviço, Obs) | `appointments` status `espera` |
| 61a7a9b6 | bloqueios de agenda (almoço, folga, recorrentes por dia da semana) | `agenda_blocks` |
| e7894755 | pacotes por cliente (Total, Utilizados, Valor de venda, Validade, Compra) | `client_packages` |
| 40ca3312, 10599ac5 | uso de sessão de pacote | `package_uses` |
| e98b5a6c | definição de pacotes | `lists` kind `package`? NÃO: guardar só no relatório cru; a tela de pacotes usa `client_packages` |
| 63d414a7 (preferido), e5b22c06, f06dac67, 8ffa26d4, 6f695f67, 56cf76ed, 85fbddc5 | itens de comanda (serviço/produto vendidos) | `sales_items` |
| d1e9f12d | pagamentos de comanda | `sales_payments` |
| cdc646d8, 1b77f624 | profissionais | `professionals` (apelido, nome completo, cargo) |
| 5d3b6c5d, e637232f, serviços que aparecem em reservas/comandas | serviços | `lists` kind `service` (cria os que faltam; categoria; preço = valor que mais se repete nas comandas, só se houver) |
| todos (inclusive os de cima) | o relatório em si | `avec_reports` (tabela saneada para rever e baixar) |

Status de reserva do Avec → nosso: Agendado→agendado, Confirmado→confirmado, Pago/Atendido/Finalizado/Em atendimento→compareceu, Faltou/Não compareceu→faltou, Cancelado→cancelado. Desconhecido: agendado e guarda o original em `avec_status`.

## Tabelas novas (migration 0022)

- `appointments`: id, contact_id (null), client_name, professional_id (null), service_id (null → lists), service_label (not null), starts_at timestamptz, duration_min smallint null, status text, avec_status text null, price_cents int null, notes text, origin text ('avec' | 'crm'), created_by_name text null, deal_id null, external_key text unique, created_at, updated_at. Índices: starts_at, contact_id, professional_id.
  Chave: `avec:res:<aaaa-mm-ddTHH:MM>|<cliente normalizado>|<serviço normalizado>` (sem profissional, porque nem todo formato traz). Horário de Salvador (UTC-3).
- `agenda_blocks`: id, professional_id null, title, notes, starts_on date, ends_on date, start_time text 'HH:MM', end_time text, weekdays smallint[] null (0=dom..6=sáb; null = todos os dias do intervalo), external_key unique, created_at.
- `client_packages`: id, contact_id null, client_name, package_name, service_label, total_sessions int, used_sessions int, price_cents int null, purchased_on date null, valid_until date null, origin, external_key unique, created_at, updated_at.
- `package_uses`: id, client_package_id null, contact_id null, client_name, used_on date, item, professional_name, comanda text, external_key unique.
- `sales_items`: id, contact_id null, client_name, sold_on date, comanda text, item, kind ('servico'|'produto'|'pacote'|'outro'), category, professional_id null, professional_name, qty numeric, value_cents, discount_cents, total_cents, from_package bool, origin, external_key unique. Chave: `avec:item:<data>|<comanda>|<item normalizado>|<profissional normalizado>|<valor>`.
- `sales_payments`: id, contact_id null, client_name, comanda, paid_on date, comanda_on date, method, value_cents, external_key unique.
- `avec_reports`: id, signature, title (nome amigável derivado do formato, ex.: "Reservas", "Itens de comanda"), file_name, columns jsonb (só as colunas permitidas), rows jsonb (array de arrays de string, saneado), row_count, date_from date null, date_to date null, imported_at, imported_by uuid null, applied jsonb (resumo do que entrou: {contatos, agendamentos, …}). Unique (signature, file hash) para não guardar o mesmo arquivo 2x.
- `lists`: + price_cents int null, duration_min smallint null, category text null.
- `professionals`: + full_name text null, role text null, avec_id text null.

## Telas

1. **Agenda** (`/agenda`): passa a mostrar `appointments` junto com os leads agendados (união; item diz de onde veio). Nova visão **"Profissionais"** (dia em colunas por profissional, linhas de 30 min, 7h–21h, bloqueios em cinza listrado, cada horário com cliente/serviço/status). Compareceu/Faltou/Cancelar também em agendamento. Aba **Lista de espera** e aba **Pacotes** (quem tem, sessões usadas/total, validade, próxima data agendada da cliente, quem está acabando ou vencendo).
2. **Ficha da cliente** (`/contatos/[id]`): Próximos horários, Pacotes (barra de sessões), Histórico de atendimentos/compras (data, item, profissional, valor só para quem vê valores), etiquetas vindas do Avec. No painel de contexto da conversa: próximo horário e pacote ativo, uma linha cada.
3. **Relatórios do Avec** (`/relatorios/avec`, só gestão — perm `relatorios.ver`): lista por tipo e período, abre a tabela (busca, paginação), **Baixar Excel** (.xlsx gerado da tabela saneada) e **Baixar PDF** (mesmo mecanismo de PDF já usado em Relatórios). Botão **Enviar relatórios do Avec** (vários .xlsx de uma vez): saneia, guarda e aplica os importadores, mostrando o resumo do que entrou.
4. **Configurações › Serviços**: preço, duração e categoria editáveis; **Profissionais**: apelido, nome completo, cargo.

## Código

- `src/server/domain/avec/` — `xlsx.ts` (ler .xlsx com exceljs → string[][]), `sanitize.ts`, `formats.ts` (detecta formato pelo conjunto de cabeçalhos, não pela assinatura exata), `normalize.ts` (nomes, dinheiro, datas, status), importadores por destino, `apply.ts` (roda tudo para um arquivo, idempotente, numa transação por arquivo), testes com planilhas sintéticas (NUNCA dados reais no repo).
- `scripts/importar-avec.ts <pasta|arquivos…>` — mesma lógica da tela, para a carga inicial no servidor.
