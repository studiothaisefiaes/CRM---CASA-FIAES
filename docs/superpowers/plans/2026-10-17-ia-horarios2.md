# IA Horários 2: horário concreto garantido — Plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (execução nativa, TDD). Passos com checkbox (`- [ ]`).

**Objetivo:** quando a cliente pede horário e a agenda tem horário livre compatível, a sugestão da IA sempre traz um horário concreto (com o botão "Marcar este horário"), nunca "vou verificar".

**Arquitetura:** a garantia é do servidor, depois da IA: uma função pura em `pos.ts` (`garantirHorario`) tira as frases de "vou verificar" e, se não sobrar hora, acrescenta a proposta do primeiro horário compatível da linha "Horários livres". `suggest.ts` e `avaliar.ts` usam o mesmo acabamento (`finalizar`), então a avaliação mede o que a tela mostra. O prompt deixa de mandar "dizer que vai verificar" quando há horários. A concordância da cliente ("Então pode ser 14:30", "Correto", "Só para confirmar, 9h?") passa a ser reconhecida e o horário que ela já tem marcado não vira "ocupado".

**Stack:** Next 16, TypeScript, drizzle, vitest (IA falsa por `Caller`; nenhum teste chama a Anthropic).

**Spec:** pedido do dono (17/10) + diagnóstico abaixo. Avaliação real anterior: `~/ClaudeGerado/avaliacao-ia-horarios.md` (fora do repositório, tem conversa de cliente).

## Diagnóstico (superpowers:systematic-debugging)

Avaliação real de 17/10, 20 conversas (`--so-horario`): 16 com horários na mão, 7 com horário proposto, 3 "vou verificar". Os 13 sem horário, por causa-raiz:

1. **"Vou verificar" com horários na mão (3 + 1 não contado).** Os três padrões:
   - P1 (Joaquim, #7): "…amanhã à tarde ainda não tenho um horário confirmado na agenda, então vou verificar e te aviso." — pediu profissional (Jackson) que não está na linha; a IA preferiu adiar a oferecer outro.
   - P2 (Bruna, #14): "Vou verificar a agenda das 12h de hoje com a equipe." — remarcação → `precisa_humano`, e o prompt manda, para `precisa_humano`, "acolher e dizer que vai verificar" (conflita com a seção Horários).
   - P3 (Luanda, #16): "Vou verificar com Gilvan se consigo…" — "verificar com <profissional>", também com `precisa_humano`.
   - Não contado (Larissa, #6): "Vamos verificar…" — o detector `saysWillCheck` só pega "vou". (E ela estava cancelando: "desagendar" casa com "agenda" em `asksForSlots`.)
   - Agravante: o pós-processamento (`semPromessaDeRetorno`) troca "Já te retorno!" por "Vou ver isso para você!" — ele mesmo produz um "vou ver".
   - Causa comum: nada no servidor garante a proposta; só a instrução, que o Haiku descumpre quando outra instrução (precisa_humano) puxa para o lado oposto.
2. **Concordância não reconhecida (6: #12, 15, 17, 18, 19, 20).** `isAgreement` exige que a mensagem COMECE com "pode ser/sim/…" e rejeita qualquer "?": falham "Então pode ser 14:30", "Oi, pode marcar!", "Bom dia Confirmado", "As 13:00hs / Correto", "Então ficamos com 14:30 mesmo?", "Certo! Só para confirmar, 9h?". Sem `combinado`, a IA devolve "hc" que não existe → sem horário. Risco latente: com a concordância reconhecida, o horário que ELA já tem marcado conferido em `slotStillFree` dá "ocupado" (o horário dela conflita com ela mesma).
3. **Sem pedido de horário de verdade (4: #1 robô, #5, #11, #6 cancelamento).** Correto não propor.

## Rulings

- **R1 — troca determinística, não segunda geração.** A segunda chamada custaria mais uma chamada inteira (~US$ 0,0005–0,001 e +2–4 s) e o Haiku pode repetir o "vou verificar". A troca no servidor custa zero, é instantânea, testável e sempre cumpre. O texto da proposta é fixo no padrão da Casa: "Tenho terça, 21/10, às 15h com Gilvan. Posso reservar pra você?".
- **R2 — quando a garantia age:** só com opções na linha (`free.options.length > 0`), com a cliente pedindo horário de verdade (`pediuHorario`) ou com o combinado "ocupado"/"regra", e nunca com combinado "ok"/"ambíguo"/"já marcado". Age em dois casos: (a) há frase de "vou verificar" → a frase sai; (b) depois disso não sobra hora nenhuma no texto. Se a IA já citou uma hora (mesmo fora da lista, ex.: confirmação "às 14h30"), o texto fica como está (não troca uma confirmação por outra hora).
- **R3 — "primeiro horário compatível":** das opções (já filtradas por serviço, regra "só com" do Método e sem assistente), a primeira cuja profissional a cliente citou; senão a primeira com a hora que ela citou; senão h1.
- **R4 — uma pergunta só:** a proposta termina com a única pergunta; as outras perguntas do texto saem (o "Tudo bem?" do cumprimento fica, como em `umaPerguntaSo`).
- **R5 — nomes:** Thaise vira "nossa Diretora Técnica, Thaise Fiaes"; os demais, o primeiro nome. Sem artigo. Frase que cita assistente sai.
- **R6 — o botão:** continua só abrindo a folha preenchida. A garantia grava `horario` = a opção escolhida, então o botão aparece em toda sugestão garantida. Mesmo com `precisa_humano`.
- **R7 — "pediu horário":** `asksForSlots` menos o que não é pedido: só "manutenção"/"livre"/"dia" soltos não contam, e cancelamento sem remarcar ("desagendar", "desmarcar", "cancelar") não conta.

## Global Constraints

- Tudo em PT-BR. Modelo sempre `claude-haiku-5-5`.
- Uma pergunta só, no fim. Sem "oi" no meio da conversa. Nunca prometer prazo. Sempre "Método Fiaes®". "nossa Diretora Técnica, Thaise Fiaes", sem artigo antes de nomes. Avaliação do Método só com Thaise. Assistente (`professionals.assistant_of`) nunca é oferecida. Tom acolhedor; emoji só às vezes (a proposta não leva emoji).
- "Marcar este horário" nunca marca sozinho.
- Testes só com IA falsa. Sem migration nova.

## Review Focus

1. Confirmação com hora fora da lista ("Fica confirmado às 14h30") não pode ser trocada por outra hora → teste em Task 2.
2. Cancelamento ("vou precisar desagendar") não recebe proposta → teste em Task 1 (`pediuHorario`).
3. Texto que só tinha "vou verificar" + pergunta vira só a proposta, com uma pergunta → teste em Task 2.
4. Cliente que cita assistente ("com Sidney") nunca recebe Sidney → teste em Task 3.
5. Concordância com o horário que ela já tem marcado não vira "ocupado" → teste em Task 4.

---

### Task 1: detectores puros (`vaiVerificar`, `pediuHorario`)

**Files:** Modify `src/server/ai/pos.ts`, `src/server/ai/horarios.ts`, `src/server/ai/suggest.ts` (`saysWillCheck` passa a ser `vaiVerificar`). Test: `pos.test.ts`, `horarios.test.ts`.

**Produces:** `vaiVerificar(t: string): boolean` (pos.ts); `pediuHorario(texts: (string|null|undefined)[], year?: number): boolean` (horarios.ts).

- [ ] Teste `vaiVerificar`: verdadeiro para P1 "…então vou verificar e te aviso.", P2 "Vou verificar a agenda das 12h de hoje com a equipe.", P3 "Vou verificar com Gilvan se consigo deixar o teste e a realização no mesmo dia para você, tudo bem?", "Vamos verificar o seu cancelamento", "Vou ver isso para você!", "Deixa eu ver a agenda", "Vou dar uma olhada", "Já te retorno"; falso para "Tenho quarta às 9h com Gilvan.", "Te vejo quarta!", "Vou te ver quarta!", "Você vai ver o resultado".
- [ ] Teste `pediuHorario`: verdadeiro para "Tem horário sábado à tarde?", "quero agendar", "pode ser 15h?", "Consegue reagendar para 12:00?", "quero remarcar, vou precisar cancelar"; falso para "Infelizmente vou precisar desagendar", "quero cancelar meu horário", "Quanto custa a manutenção?", "Bom dia".
- [ ] Rodar, ver falhar; implementar; rodar, passar; `saysWillCheck` = `vaiVerificar`.
- [ ] Commit `feat(ia): detecta "vou verificar" e pedido de horário de verdade`.

### Task 2: `garantirHorario` (pos.ts)

**Produces:**
```ts
export type GarantiaInput = { opcoes: ProposedSlot[]; pediu: boolean; textosCliente: string[]; fora?: string | null; assistentes?: string[] };
export function garantirHorario(t: string, i: GarantiaInput): { texto: string; horario: ProposedSlot | null; trocou: boolean };
export function escolherOpcao(opcoes: ProposedSlot[], textosCliente: string[]): ProposedSlot | null;
export function propostaTexto(s: ProposedSlot, fora?: string | null): string;
```
`fora`: o rótulo da janela pedida sem nada livre ("sáb 17/10 à tarde"): a proposta vira "Para sáb 17/10 à tarde não tenho horário livre; o mais próximo é terça, 20/10, às 9h com Ilma. Posso reservar pra você?".

- [ ] Testes (opções fixas): P1/P2/P3 viram texto sem "vou verificar", terminando na proposta, uma "?" só, `horario` = opção escolhida; P1 sem Jackson na lista → h1; P2 com "12:00" pedido → a opção das 12h; cliente cita "Gilvan" → opção de Gilvan; Thaise → "com nossa Diretora Técnica, Thaise Fiaes"; `pediu=false` ou sem opções → texto igual; texto com hora ("Fica confirmado às 14h30") → igual; texto sem hora e sem "vou verificar" ("Qual dia fica melhor?") → proposta; com `fora` → frase "Para … não tenho horário livre; o mais próximo é …"; nenhum "Oi" acrescentado, nenhum prazo.
- [ ] Rodar, ver falhar; implementar; passar. Commit `feat(ia): pós-processamento garante horário concreto`.

### Task 3: ligar no servidor e na avaliação

**Files:** `horarios.ts` (`formatFreeHours` devolve `fora: string | null`), `horarios-agenda.ts` (`freeHoursLine` repassa `fora`), `suggest.ts` (`freeHoursFor` devolve `pediu`, `texts`; `finalizar`; `fillSuggestion`; `loadCasaData` ganha `assistentes`), `prompt.ts` (precisa_humano não manda mais "dizer que vai verificar" com horários), `avaliar.ts` (usa `finalizar`; conta `vouVerificarCru` e `garantidas`). Test: `suggest.test.ts`, `avaliar.test.ts`, `prompt.test.ts`.

**Produces:** `finalizar(r: CallResult, req: Awaited<ReturnType<typeof prepareRequest>>, now: Date, assistentes: string[]): { sugestao: string; horario: ProposedSlot | null; garantido: boolean }`.

- [ ] Testes em `suggest.test.ts` (IA falsa): os 3 padrões gravam sugestão com horário concreto e `horario` não nulo, e `pronta().horario` existe (botão); "sábado à tarde" → proposta de sábado à tarde (h1 da janela); Método → só Thaise (cliente pede "avaliação do Método com Jackson", IA diz "vou verificar" → Thaise); assistente: Sidney (assistant_of Thaise) faz o serviço, cliente pede "com Sidney", IA responde "Tenho quarta às 9h com Sidney" → a frase sai, a proposta é com a principal, "Sidney" nunca aparece nem no prompt nem na sugestão; nada vai para `outbox` nem `appointments`.
- [ ] Teste do prompt: a regra de precisa_humano diz para propor o horário da lista quando houver.
- [ ] Teste `avaliar`: "vou verificar" cru conta em `vouVerificarCru`, o final tem horário, `garantidas` = 1.
- [ ] Ajustar o teste antigo "Sugestão sem horário (vai verificar): sem aviso" (agora vira proposta com aviso de agenda).
- [ ] Commit `feat(ia): servidor garante o horário concreto na sugestão e na avaliação`.

### Task 4: concordância da cliente

**Files:** `horarios.ts` (`isAgreement`), `suggest.ts` (`combinadoFor`: status `ja_marcado`), `prompt.ts` (`Combinado` + linha do `ja_marcado`). Test: `horarios.test.ts`, `suggest.test.ts`.

- [ ] Testes `isAgreement` verdadeiros: "Então pode ser 14:30", "Oi, pode marcar!", "Bom dia Confirmado", ["Obrigado", "As 13:00hs", "Correto"], "Então ficamos com 14:30 mesmo?", "Bom dia. Certo! Só para confirmar, 9h?", "As 13:00 né"; continuam falsos os atuais ("pode ser às 16h?", "Tem outro horário?"…).
- [ ] Teste `combinadoFor`: cliente com horário ativo marcado no dia/hora oferecidos diz "Correto" → prompt "já está marcado", sem "NÃO está livre", `horario` nulo (sem botão: já está marcado).
- [ ] Commit `fix(ia): reconhece a concordância da cliente e o horário que ela já tem`.

### Task 5: o botão "Marcar este horário"

**Files:** Test `src/components/lead/ai-suggestion.test.tsx`.

- [ ] Teste: com `horario` aparece o botão também com `precisaHumano`; sem `onBook` não aparece; renderizar não chama `prepareAiBookingAction`. Se já coberto, só o que faltar.
- [ ] Commit `test(ia): botão Marcar este horário sempre que houver horário`.

### Task 7: achados da avaliação real (acrescentada depois da Task 6)

**Files:** `pos.ts` (`garantirHorario`: hora inventada), `horarios.ts` (`daysIn`: "sábado que vem"). Test: `pos.test.ts`, `horarios.test.ts`, `suggest.test.ts`.

- [ ] Caso Leomar: a IA ofereceu "sábado que vem (24/10) às 11h" com a lista só tendo sáb 17/10 12h30 → frase com hora que não é da lista nem pedida pela cliente sai e entra a proposta (faixa "das 9h às 18h" não conta).
- [ ] "sábado que vem"/"próximo sábado" dito na sexta ou no sábado = o da semana seguinte.
- [ ] Commit `fix(ia): hora inventada vira a proposta da lista; 'sábado que vem' na véspera`.

### Task 6: verificação e avaliação real

- [ ] `npx vitest run`, `npx next typegen && npx tsc --noEmit`, `npm run lint`.
- [ ] Cópia local (banco `crm_ia2_aval`) de 20 conversas recentes por SELECT em produção (fora do repositório), `scripts/ai-avaliar.ts --n 20 --so-horario` com `ANTHROPIC_API_KEY` só no ambiente do comando; ≤ 20 chamadas, < US$ 0,30. Apagar a cópia (banco e arquivos).
