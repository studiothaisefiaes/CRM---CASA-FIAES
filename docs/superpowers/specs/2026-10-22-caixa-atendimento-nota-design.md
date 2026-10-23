# Caixa igual ao Avec, atendimento com controle e nota fiscal homologada — desenho (22/10/2026)

## Por quê

Pedido do dono (22/10, áudio): "a lógica do caixa, o histórico, a comanda ainda tá ruim, a tela tá ruim. Veja no Avec, quero que fique exatamente
igual, porém adicionar coisas: botar quantos assistentes eu quiser, criar uma nova comanda com pessoa específica, quem é o cliente, pesquisar melhor.
Melhorar o fluxo em atendimento a partir dos avisos, se chegou ou não, pra gente ter um controle melhor; melhorar o Ao vivo." E: "estou com o
certificado digital e o CSC; tem que fazer testes e homologação." Ele pediu para não fazer perguntas ("monta o plano e só bora"): as decisões
abaixo marcadas **[minha]** são minhas e podem ser revistas.

Sucesso = a recepção (Cati, Sara) fecha o dia inteiro no CRM sem abrir o Avec: sabe quem chegou, quem está na cadeira, quem faltou e quem falta
pagar; abre e fecha comanda tão rápido quanto no Avec; acha qualquer comanda antiga; e a nota sai.

Anti-objetivos: tela nova "bonita" que fica mais lenta que o Avec; perder dinheiro/comissão na migração de regras (assistentes, dívida, crédito);
qualquer envio automático para cliente (regra da Casa: nada sai sozinho); nota de produção antes da homologação passar.

## Levantamento (22/10)

- **Comanda/caixa:** o miolo já existe (várias formas de pagamento, parcial, dívida, crédito, caixa por pessoa, sangria/suprimento, contagem
  cega). Falta o que a recepção usa o dia todo: nova comanda só aceita nome em texto livre (não busca cliente, `setClientAction` sem tela);
  serviço é um `<select>` sem busca; assistentes travadas em 2 (banco `in (1,2)`, `MAX_ASSISTANTS`, divisão "metade"); não existe lista de
  comandas finalizadas (só "Pagas hoje"); a ficha da cliente não mostra as comandas do CRM; histórico de caixas escondido em "Fechar o dia".
- **Atendimento:** Chegou é marcado à mão; o robô do Avec traduz "Aguardando" (= chegou) para `conferir`, que some do Hoje e do Ao vivo, e
  "em atendimento" para Finalizado. Resultado: o Ao vivo mostra como atrasada quem está na cadeira. O Ao vivo é só leitura (sem botões); a
  atrasada fica em cinza, sem aviso; não há fechamento do dia.
- **Nota:** NFS-e Nacional (Sefin) e NFC-e (SVRS, para a BA) já estão no código, com fila, idempotência e trava de produção até homologar.
  Roteiro pronto em `docs/fiscal/roteiro-homologacao.md`. Em 22/10 23h: certificado A1 (válido até 07/04/2027), CSC de homologação e a raiz
  ICP-Brasil v10 instalados no servidor; o CRM lê o certificado (CNPJ confere). CNPJ público: Simples Nacional desde 2009, CNAE principal 9602-5/01,
  secundário 4772-5/00 (pode NFC-e). Faltam no CRM: Dados da Casa (nada salvo), Inscrição Municipal, NCM dos 337 produtos (nenhum tem).

## Fases (nesta ordem)

### F0 — Nota fiscal em homologação (1 noite)
1. Preencher Dados da Casa pelo próprio CRM (com auditoria): razão social, CNPJ, IE 132534688, endereço do CNPJ, regime Simples,
   município 2927408, séries. **Inscrição Municipal e cTribNac/alíquota do ISS: pedir ao contador** (sem isso a NFS-e não sai).
2. NCM: preencher por grupo de produto (shampoo, condicionador, máscara, óleo…: NCM 3305.xx) com sugestão automática pelo nome + revisão na
   tela; o contador confere a tabela. CFOP 5102, CSOSN 102 **[minha, padrão de Simples revendendo; contador confirma]**.
3. Chaves em **Teste**; seguir o roteiro: NFC-e (comanda de teste com produto, Pix+cartão, cStat 100, QR abre na SEFAZ-BA, cancelar em 30 min) e
   NFS-e (CPF, cancelamento, reenvio recusado, trocar SHA-1/256 se E0714). Anotar códigos e corrigir as constantes "NÃO CONFIRMADO".
4. Produção só com OK do dono + contador. Trocar o CSC para o de produção no `.env`.

### F1 — Comanda e caixa no nível do Avec
1. **Assistentes ilimitadas** por serviço: migration `position >= 1`; fim do `MAX_ASSISTANTS`/`slice`; `assistentesMax` sem teto; comissão:
   cada assistente com sua regra (fixo/%), e a regra "metade" vira divisão igual entre N **[minha]**; tela com "+ assistente" sem limite.
   A agenda já guarda até 20 e passa todas para a comanda.
2. **Nova comanda de verdade:** busca de cliente (nome, telefone, CPF; mãe/filha do mesmo número; "cliente nova" na hora) com o `ClientPicker`
   da agenda; profissional no topo, que vira padrão dos itens; "Trocar cliente" na comanda aberta.
3. **Busca de serviço/produto que digita e filtra**, priorizando o que a profissional faz e mostrando o preço; teclado (↑↓ Enter).
4. **Comandas (histórico):** aba nova `/caixa/comandas` como "Comandas finalizadas/pendentes" do Avec: filtros data/período, status
   (aberta, paga, com dívida, cancelada), cliente, profissional, nº; abre a comanda; editar/estornar com motivo pelas regras que já existem.
5. **Comandas na ficha da cliente** (aba): as do CRM + vendas importadas do Avec, com itens, valor e quem atendeu.
6. **Caixa:** conferência por forma de pagamento clicável (vê as comandas de cada forma); "Histórico de caixas" como aba própria.
7. **Tela da comanda no jeito Avec** **[minha leitura do Avec pelos textos]**: cabeçalho fixo (nº, cliente, profissional, total, a pagar);
   botões de item lado a lado (Serviço, Produto, Pacote, Crédito de pacote, Dívida); botão "T" que preenche o total no pagamento; atalhos.
   Antes de codar, **mockup** comparado com prints do Avec (pedir à Cati 3 prints: comanda aberta, pagamento, comandas finalizadas).

### F2 — Atendimento e Ao vivo com controle
1. **Chegada:** o CRM passa a ser onde se marca Chegou **[minha]**, e o robô do Avec deixa de esconder: "Aguardando" → `chegou`,
   "em atendimento" → `em_atendimento` (só sobe status, nunca rebaixa o que a recepção marcou). Robô no horário da Casa a cada 10 min.
2. **Ao vivo com botões:** Chegou / Faltou (diálogo de 3 opções que já existe) na Próxima e nas atrasadas; Iniciar em "esperando começar";
   Finalizar no Agora; Receber (abre a comanda) em "a receber".
3. **Escala de atraso:** 10 min âmbar na tela; 15 min aviso no sino (grupo agenda, tipo novo `cliente_atrasada`); 30 min "Chegou ou faltou?".
   Mensagem "estamos te esperando" só como sugestão (nunca envia sozinha).
4. **Chegou abre a comanda na hora** com a visita inteira (todas as profissionais e assistentes), sem precisar visitar o Caixa.
5. **Para resolver hoje / Dia fechado:** faixa no Ao vivo e na Recepção com o que passou da hora sem desfecho, finalizado sem pagar e
   `conferir`, cada linha com o botão certo; o dia fecha quando tudo está Pago ou Faltou.
6. **Confirmação visível:** ponto verde + "confirmou por…"; contador de "não confirmaram" de hoje e amanhã.
7. Conferir no sistema os itens 28–31 da lista da Cati.

### F3 — Resto do Avec que a Casa usa
Imprimir comanda e relatório de caixa; Caixinha e Vale-presente como item; produto usado no serviço (gramas). Só depois de F1–F2 no ar.

## Como se constrói (regras que valem para todas as fases)
- Branch `cati-2010` → merge em `ia-sugestao`; TDD (testes de domínio primeiro); `tsc` limpo; deploy só 17h–9h; backup antes; GitHub público
  depois de cada deploy (`ops/github-publicar.sh`); migrations com `when` > 1792640000000 (próxima livre: 0092).
- Cada fase sai em pedaços que vão para o ar sozinhos (uma noite cada), na ordem acima dentro da fase.
- Permissões novas: conferir `ops/perfis-conferir.ts` depois do deploy (permissão nova não chega sozinha aos perfis).
- Tela: mesmo visual do CRM (sem redesign); medir a tela de Caixa antes/depois (não pode ficar mais lenta: lição do 22/10, Clientes travando
  o servidor 51 s).

## Dependências externas
- Contador: Inscrição Municipal, código de tributação nacional/ISS da NFS-e, conferência de NCM/CFOP/CSOSN/PIS-COFINS.
- Cati: 3 prints do Avec (comanda aberta, pagamento, comandas finalizadas).
- Dono: OK para produção da nota.
