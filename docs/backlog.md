# Lista mestra: CRM Casa Fiaes

Tudo o que foi pedido, o que está pronto e o que falta. Atualizada a cada entrega.
Objetivo: substituir o ChatGuru e o Avec num sistema só, com design muito melhor (referência: Apple). Campanhas depois.
✅ no ar · 🔨 fazendo agora · 📝 anotado (próximo) · 💡 ideia · ⏳ depende da Casa

Pesquisas que embasam: `docs/chatguru-pesquisa.md`, `docs/chatguru-engenharia-reversa.md` (51 itens, 13 lotes), `docs/avec-pesquisa.md`.

## Pedidos do Joaquim (14/10/2026)

| | Pedido | Situação |
|---|---|---|
| ✅ | Sistema mais rápido (o link passava por um desvio) | casafiaes.pages.dev agora redireciona direto ao servidor |
| ✅ | Recepção e atendente fazem o mesmo; Relatórios só a gestão | no ar |
| ✅ | Agenda (dia/semana), Compareceu/Faltou ali mesmo | no ar |
| ✅ | Transferir conversa e ficar marcado "Transferida por…"; a pessoa recebe no login e no sino | no ar |
| ✅ | Etiquetas na conversa; a equipe cria | no ar |
| ✅ | Profissionais por serviço; ao agendar escolher serviço, profissional, dia e hora | no ar |
| ✅ | Arquivar conversa: terminou → Arquivadas; cliente escreve → volta para a Fila esperando | no ar |
| ✅ | Apresentação Equipe + Gestão | casafiaes-treinamento.pages.dev |
| ✅ | Lista de pedidos e ideias sempre atualizada | este arquivo |
| ✅ | Pesquisa completa do ChatGuru e do Avec (engenharia reversa) | docs/ |
| ✅ | API do ChatGuru funcionando (s18, chave validada) | só tem ações de envio; não lê histórico |
| ✅ | Criar login direto (e-mail e senha pela gestão), sem convite; trocar senha | no ar |
| ✅ | Login de gestão da Cati; login atendente da Sara | no ar (senhas no cofre) |
| ✅ | Joaquim "especial": não recebe nenhuma conversa | gestão nunca recebe sozinha; 162 conversas viraram Sem dono |
| ✅ | Puxar a ficha do ChatGuru (etiquetas, campos, responsável) | endereço de importação pronto; falta o diálogo no painel do ChatGuru (ver Casa) |
| ✅ | Número oculto (@lid): conversa entra como "Número oculto" (antes era descartada); 39 mensagens recuperadas (eram envios da Casa) | no ar; responder pelo CRM a @lid bloqueado até testar envio |
| ✅ | Análise profunda do Avec com agentes | docs/avec-engenharia-reversa.md (48 lacunas, 14 essenciais, desenho da agenda e do app da profissional) |
| 📝 | Agenda própria (sair da do Avec): cadastrar as profissionais (quem corta, quem faz unha…) com login, e cada uma vê no celular o que tem para hoje | desenho vem da análise do Avec |
| ✅ | "Atrasado há 773 h" não existe: passou do dia → sai de Atrasados, vai para Follow-up 1 com "Retomar contato" para hoje | no ar 14/10 |
| ✅ | Importar o cadastro de clientes do Avec: 5.739 novas + 132 completadas (5.871 clientes, 3.653 aniversários); sem CPF/RG/endereço | no ar 14/10. Falta: coluna Obs, aceitar .xlsx direto na tela |
| ✅ | Organizar as conversas: bater com o arquivo de clientes (números), ler cada conversa e pôr o lead na etapa certa (agendado, fechado, follow-up…), avisos fazendo sentido | depois do @lid e dos atrasados |
| ✅ | Na tela de Atendimento, o menu da esquerda encolhe (só ícones); "Abrir menu" guarda a preferência | no código, publica junto com os emojis |
| 🔨 | Emojis ao escrever a mensagem, com visual no estilo Apple | fazendo |
| 📝 | Assinatura nas mensagens enviadas pelo CRM: "*NOME - CASA FIAES:*" em cima e a mensagem embaixo (igual ao ChatGuru) | próximo |
| 📝 | Configurações com mais coisas para criar (etiquetas, profissionais, respostas prontas, para onde vão as conversas); a atendente também configura a parte do dia a dia | WhatsApp, Equipe e regras seguem só com a gestão |
| 📝 | Puxar TUDO do ChatGuru (mensagens antigas, anotações, funil) | ver "Dados do ChatGuru" |
| 📝 | Sistema = ChatGuru + Avec, design melhor ("revolução") | ver planos abaixo |
| ✅ | Juntar TUDO do Avec: agenda própria (vários horários por cliente, visão por profissional, bloqueios, lista de espera), pacotes (sessões, validade, próxima data), histórico de compras/pagamentos, profissionais e serviços, todos os números como contato, e área "Relatórios do Avec" (rever, baixar Excel/PDF, enviar mais) | no ar 14/10 (r13) com os 224 relatórios reais importados (desde 2020: 25.280 horários, 25.914 itens, 19.896 pagamentos, 3.934 bloqueios, 31 pacotes, 18 profissionais, 55 serviços). Duração dos serviços NÃO vem do Avec (coluna Tempo vazia): Casa preenche em Configurações › Serviços |
| 🔨 | Respostas pelo ChatGuru/celular caindo em contato "Número oculto" (@lid) e a conversa com número ficando "atrasada" | juntar @lid ↔ número pelo banco do WhatsApp (14 de 17 resolvíveis) |
| ✅ | "Obrigada!", "ok", 👍 ou só emoji depois da resposta da Casa não deixa a conversa esperando/atrasada | no ar 14/10 (r11); 3 conversas saíram de Atrasados na hora |
| ✅ | Mandar e depois criar um aviso: "Enviada. E agora?" (Retomar depois / Agendar / Encerrar) + Retomar depois (lembrete com dia, vai para Follow-up, sai de Atrasados, volta em Ações de hoje) + "Próximo passo" claro no painel | no ar 14/10 (r12) |
| 💡 | IA lendo a conversa: entender "eu entro em contato" e sugerir Retomar depois sozinha, e casos que a regra fixa não pega | depois (custo de IA) |
| 📝 | Marcar horário novo direto pela Agenda (hoje é pelo "Agendar" na conversa) | próximo da agenda |
| 📝 | Remarcação no Avec vira dois horários (o Avec não manda o ID da reserva) | só afeta o histórico importado |
| 📝 | Relatórios do Avec: esconder colunas de dinheiro para quem não vê valores (hoje só a gestão abre, então não aparece) | se abrir para outros perfis |
| 📝 | Relatórios do Avec: principais primeiro e relatórios vazios recolhidos (hoje em ordem alfabética, com 46 vazios no meio) | próximo ajuste |
| 💡 | Campanhas | só depois, e sempre com ok antes de enviar |

## Do ChatGuru: 13 lotes (da engenharia reversa)

| | Lote | O que entrega |
|---|---|---|
| 📝 | 1. Não perder sinal da cliente | "visto" só quando a responsável abre; ligação perdida vira item e espera; reação aparece (👍 no lembrete confirma) |
| 📝 | 2. Número oculto (@lid) | cliente que chega sem número visível vira lead normal (hoje é ignorada) |
| 📝 | 3. Nota interna | balão "só a equipe vê", @menção no sino |
| 📝 | 4. Importador do histórico | assistente "Migrar do ChatGuru" (CSV/JSON) com prévia, idempotente |
| 📝 | 5. Mesclar duplicados | "parece a mesma pessoa", lado a lado, desfazer |
| 📝 | 6. Ficha e etiquetas | perguntas da ficha (campos), tela de etiquetas com cor/renomear/juntar, filtrar a Fila por etiqueta |
| 📝 | 7. Agenda de verdade | serviço com duração e preço, só horários livres, preço em Fechar venda; lembrete da véspera; "Preciso remarcar" oferece horários |
| 📝 | 8. Produtividade | mensagem agendada, biblioteca de arquivos, respostas prontas com anexo/variáveis, editar/apagar mensagem |
| 📝 | 9. Saída de dados | exportar contatos (CSV), card "Mensagens que não chegaram" |
| 📝 | 10. Automações | pausar por cliente, "sugerir em vez de enviar", gatilhos e ações novas |
| 📝 | 11. Equipes e triagem | departamentos, menu de boas-vindas |
| 📝 | 12. Gestão | "Equipe agora" no Hoje, tempo típico de resposta, resumo enviado sozinho |
| 💡 | 13. Opcionais (decisão da Casa) | transcrição de áudio (custo de IA), pesquisa de satisfação, campanhas |

## Do Avec: 3 ondas

| | Onda | O que entra |
|---|---|---|
| 📝 | 1. Balcão | serviços com preço e duração; agenda em colunas por profissional; comanda com vários serviços; caixa do dia; comissão na comanda; ficha com histórico |
| 📝 | 2. Rotina | pagar comissão, anamnese/prontuário (tricologia), pacotes, financeiro, visão da profissional no celular, estoque básico |
| 💡 | 3. Crescer | agendamento online, IA que agenda pelo WhatsApp, campanhas e avaliação, nota fiscal |

## Dados do ChatGuru (o que dá para puxar)

| | Dado | Como |
|---|---|---|
| ✅ | Conversas desde 23/04 (7.350 mensagens) | WhatsApp do salão conectado no CRM |
| ⏳ | Ficha (etiquetas, campos, responsável) | diálogo "Post para URL" no painel + `dialog_execute` (testar com 1 contato) |
| ⏳ | Contatos + etiquetas | painel: Relatórios › Chats › Exportar CSV |
| ⏳ | Etapa do funil | painel: Funil › Exportar CSV |
| ⏳ | Mensagens antigas (antes de abril) e anotações | painel: Relatórios › Mensagens (mês a mês); rotas do painel com a admin logada; pedido LGPD ao ChatGuru antes de cancelar |
| ⏳ | Avec | token da API de Relatórios + Excel pelo menu Relatórios; pedir exportação completa antes de cancelar |

## Feito em 14/10 à tarde (registro)
- 179 conversas lidas e organizadas (agentes + revisão cética): 32 agendadas (aparecem na Agenda), 50 follow-up, 53 arquivadas, 7 perdidas, resumo em Observações e próxima ação sugerida. Estado anterior salvo em /home/crm/backups/organizacao-2026-10-14-antes.json.
- Mídia do WhatsApp agora em pasta fixa (/home/crm/crm-media); 287 arquivos recuperados dos backups depois de se perderem nas trocas de versão.

## Avisos importantes
- ⚠️ A análise do Avec achou uma rota pública do Avec que expõe CPF, e-mail, celular e dados bancários das profissionais (docs/avec-engenharia-reversa.md, seção 4.4). Avisar a Thaise / o Avec.

## Depende da Casa

- ⏳ Domínio crm.casafiaes.com.br (registro na Hostinger da Casa, outra conta).
- ⏳ Criar no ChatGuru o diálogo "Exportar ficha" só com "Post para URL" (o endereço está no cofre).
- ⏳ Exportar os CSVs do ChatGuru (Chats, Funil, Mensagens) e mandar.
- ⏳ Pedido formal de exportação (LGPD) ao ChatGuru e ao Avec antes de cancelar.
- ⏳ Preços, durações e comissões dos serviços (para a Onda 1 do Avec).
