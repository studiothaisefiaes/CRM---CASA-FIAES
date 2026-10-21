import type { Deductions } from "@/lib/commission-math";
import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, unique, index, smallint, primaryKey, date, numeric, bigint, real, check, customType, type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * `timestamptz` que aceita 'infinity' ("até alguém religar"). O driver devolve o número Infinity (que vira Invalid Date e quebra a
 * serialização para a tela); aqui 'infinity' vira a data máxima do JavaScript e volta ao gravar. `PAUSE_FOREVER` é essa data.
 */
export const PAUSE_FOREVER = new Date(8_640_000_000_000_000);
const timestamptzInfinity = customType<{ data: Date; driverData: string | number | Date }>({
  dataType: () => "timestamp with time zone",
  toDriver: (v) => (v.getTime() >= PAUSE_FOREVER.getTime() ? "infinity" : v.toISOString()),
  fromDriver: (v) => (v === Infinity || v === "infinity" ? PAUSE_FOREVER : new Date(v)),
});

export const roleEnum = pgEnum("role", ["gestor", "atendente"]);
/** `na_casa` (0035, pedido do dono 15/10): a cliente está no salão (Chegou/Em atendimento), entre Agendado e Atendida. */
export const stageKindEnum = pgEnum("stage_kind", ["lead", "atendimento", "agendado", "followup", "fechado", "perdido", "proposta", "atendido", "retorno", "na_casa"]);
export const directionEnum = pgEnum("direction", ["in", "out"]);
export const listKindEnum = pgEnum("list_kind", ["objection", "lost_reason", "quick_reply", "origin", "service", "keyword"]);
export const channelStatusEnum = pgEnum("channel_status", ["desconectado", "aguardando_qr", "conectado", "erro"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Perfis de acesso (Configurações › Equipe › Perfis). `key` só nos perfis de sistema (gestao, atendente, recepcao). */
export const profiles = pgTable("profiles", {
  id: id(),
  key: text("key").unique(),
  name: text("name").notNull(),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("profiles_name_uq").on(sql`lower(${t.name})`)]);

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  /** Coluna antiga, mantida em sincronia com o perfil (legacyRoleOf) para o código antigo funcionar numa volta de versão. */
  role: roleEnum("role").notNull().default("atendente"),
  profileId: uuid("profile_id").references(() => profiles.id),
  /** Distribuição: disponivel | pausa | ausente (e quando mudou), último sinal do CRM aberto, nível de prioridade (1 recebe primeiro) e último lead recebido. */
  availability: text("availability").notNull().default("ausente"),
  availabilityAt: timestamp("availability_at", { withTimezone: true }),
  /** O estado foi escolhido pela própria pessoa (vale o dia) ou veio do sistema (sumiu 5 min, saiu da conta). */
  availabilityManual: boolean("availability_manual").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  priorityLevel: smallint("priority_level").notNull().default(1),
  lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
  /** Assinatura no WhatsApp ("SARA" em "*SARA - CASA FIAES:*"): vai nas mensagens enviadas pelo CRM e diz quem respondeu pelo celular ou pelo ChatGuru. */
  signature: text("signature"),
  active: boolean("active").notNull().default(true),
  inviteTokenHash: text("invite_token_hash"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
  // Duas pessoas nunca com a mesma assinatura (o domínio confere também sem acento).
  uniqueIndex("users_signature_uq").on(sql`upper(${t.signature})`).where(sql`${t.signature} is not null`),
]);

export const sessions = pgTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const stages = pgTable("stages", {
  id: id(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  kind: stageKindEnum("kind").notNull(),
  position: integer("position").notNull(),
  slaMinutes: integer("sla_minutes"),
  staleDays: integer("stale_days"),
  color: text("color").notNull().default("#5c5c5c"),
  active: boolean("active").notNull().default(true),
  /** Perfis que veem a etapa no Quadro (Configurações › Etapas). null ou vazio = todos. A gestão vê todas; a Fila não muda (Lote 4). */
  visibleProfileIds: uuid("visible_profile_ids").array(),
  /** Aguardando cliente / Orçamento enviado: os dias das 3 tentativas (ex.: {1,3,7}). null = o padrão do tipo (src/lib/attempts.ts). */
  attemptDays: smallint("attempt_days").array(),
}, (t) => [uniqueIndex("stages_key_uq").on(t.key)]);

export const contacts = pgTable("contacts", {
  id: id(),
  name: text("name"),
  phoneE164: text("phone_e164").notNull(),
  email: text("email"),
  instagram: text("instagram"),
  birthDay: smallint("birth_day"),
  birthMonth: smallint("birth_month"),
  birthYear: smallint("birth_year"),
  isClient: boolean("is_client").notNull().default(false),
  clientSince: timestamp("client_since", { withTimezone: true }),
  lastServiceAt: timestamp("last_service_at", { withTimezone: true }),
  notes: text("notes"),
  /** Foto de perfil do WhatsApp baixada (relativo a MEDIA_DIR); avatarCheckedAt evita buscar de novo toda hora. */
  avatarPath: text("avatar_path"),
  avatarCheckedAt: timestamp("avatar_checked_at", { withTimezone: true }),
  /** "Não é cliente" (conversa pessoal, fornecedor): mensagens ficam guardadas, mas não abre lead nem alerta. */
  ignored: boolean("ignored").notNull().default(false),
  /** "Equipe": número de funcionária. A conversa aparece na aba Equipe e avisa (não lida, sino), mas fica fora do funil, das métricas e dos prazos. */
  isTeam: boolean("is_team").notNull().default(false),
  /**
   * Tipo do contato (0054, 17/10): cliente | equipe | fornecedor | spam. Equipe e Fornecedor têm lista própria no Atendimento; Spam fica escondido
   * (é o antigo "Não é cliente") e volta com "Marcar como cliente". Fornecedor e Spam ficam fora da Fila, dos números e relatórios de clientes e não
   * recebem mensagem automática nem lembrete. Um gatilho no banco mantém `isTeam` (= equipe) e `ignored` (= spam) iguais ao tipo.
   */
  kind: text("kind").$type<import("../../lib/contact-kind").ContactKind>().notNull().default("cliente"),
  /** Identificador anônimo do WhatsApp (@lid, só os dígitos). Sem número visível, o contato nasce com phoneE164 = "lid:<dígitos>". */
  waLid: text("wa_lid"),
  /** Ficha trazida do sistema antigo (ChatGuru): campos personalizados, responsável e data de cadastro de lá. Só leitura na tela. */
  importedFields: jsonb("imported_fields").$type<{ chatguru?: { campos?: Record<string, string>; responsavel?: string | null; desde?: string | null; link?: string | null; atualizadoEm?: string }; avec?: { comoConheceu?: string | null; codigo?: string | null } } | null>(),
  /** Última resposta automática de fora do expediente (evita repetir). */
  lastAutoReplyAt: timestamp("last_auto_reply_at", { withTimezone: true }),
  /** Profissional preferida escolhida na ficha: vale mais que a calculada em `contact_stats` (Lote 2). */
  preferredProfessionalId: uuid("preferred_professional_id").references((): AnyPgColumn => professionals.id, { onDelete: "set null" }),
  /** Avisos fixos (alergia, "não gosta de volume"): em destaque na ficha e na conversa. Uma linha por aviso, até 300 caracteres. */
  alertNotes: text("alert_notes"),
  /** O que a cliente aceita (Fase B): true = Sim, false = Não, null = não perguntado. "Não" vale na massa e na IA mesmo com a função desligada. */
  consentWhatsapp: boolean("consent_whatsapp"),
  consentAi: boolean("consent_ai"),
  /** Só guardado: a emissão de NFS-e com CPF é da Fase D. */
  consentCpfNota: boolean("consent_cpf_nota"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentBy: uuid("consent_by"),
  /** Automáticas pausadas: null = valendo; data = pausadas até lá; 'infinity' = até alguém religar. Vale para tudo que é automático para a cliente. */
  automationsPausedUntil: timestamptzInfinity("automations_paused_until"),
  /** CPF (pedido do dono, 16/10): só os 11 dígitos, opcional. Nunca vai para CSV, Avec, IA ou serviço de fora; a tela mostra mascarado. */
  cpf: text("cpf"),
  /** "Como ela gosta de ser chamada" (Dados da cliente, 16/10). */
  nickname: text("nickname"),
  /** Outro telefone (fixo, de casa): só para ligar; a conversa continua no WhatsApp (`phoneE164`). */
  phoneAlt: text("phone_alt"),
  /** Tipo de cabelo ("cacheado 3B, com química"). */
  hairType: text("hair_type"),
  /** Uso de imagem (0081, Fase C item 20): "sim" autorizou, "nao" não autorizou, null não informado. Quem autorizou pode ter a data (`imageUseOn`). */
  imageUse: text("image_use").$type<"sim" | "nao">(),
  imageUseOn: date("image_use_on"),
  /**
   * Várias pessoas no mesmo número (0051): a pessoa a mais (filha, mãe, marido…) é um contato com ficha própria ligado ao TITULAR do número.
   * O telefone dela é "pessoa:<uuid>" (não é número de WhatsApp): a conversa e as mensagens ficam no titular. Ver `domain/people-on-number.ts`.
   */
  sharesPhoneWith: uuid("shares_phone_with").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
  /** Quem ela é para o titular ("filha", "mãe"…); vazio = não informado. */
  phoneRelation: text("phone_relation"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("contacts_phone_uq").on(t.phoneE164), uniqueIndex("contacts_wa_lid_uq").on(t.waLid),
  index("contacts_kind_idx").on(t.kind).where(sql`${t.kind} <> 'cliente'`),
  index("contacts_shares_phone_idx").on(t.sharesPhoneWith).where(sql`${t.sharesPhoneWith} is not null`),
  check("contacts_image_use_check", sql`${t.imageUse} is null or ${t.imageUse} in ('sim','nao')`),
]);

export const lists = pgTable("lists", {
  id: id(),
  kind: listKindEnum("kind").notNull(),
  label: text("label").notNull(),
  body: text("body"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** Serviços recorrentes: de quantos em quantos dias a cliente volta (null = sem ciclo). */
  cycleDays: smallint("cycle_days"),
  /** Palavras-chave (kind "keyword"): { boost } sobe a conversa dentro da seção da Fila. As frases ficam em `body`, uma por linha. */
  meta: jsonb("meta"),
  /** Serviços: preço (centavos), duração e categoria. Vazio = não informado (o Avec nem sempre traz; nunca chutar). */
  priceCents: integer("price_cents"),
  durationMin: smallint("duration_min"),
  category: text("category"),
  /** Serviços: custo (centavos) que a regra da comissão pode descontar. Vazio = sem custo. Só quem tem `servicos.custo` vê (Fase C, 0073); nunca vai para a cliente, /agendar nem a IA. */
  costCents: integer("cost_cents"),
  /** Serviços: folga depois (min) para arrumar o posto; só pesa para a profissional. Vazio = 0. */
  bufferMin: smallint("buffer_min"),
  /** Serviços (0092): código de tributação nacional (cTribNac, 6 números) e NBS próprios; vazio = vale o padrão de Configurações › Nota fiscal. */
  fiscalCtribNac: text("fiscal_ctribnac"),
  fiscalNbs: text("fiscal_nbs"),
  /** Serviços: descrição curta (o que inclui, quem faz). Aparece na aba Serviços e vai para a sugestão da IA. Vazio = sem descrição. */
  description: text("description"),
  /**
   * Serviços (0050): "A IA oferece só com" estas profissionais (vazio = quem faz o serviço). `aiProScope`: "sempre" ou "metodo"
   * (só quando o assunto da conversa é o Método Fiaes; ex.: a avaliação do Método é só com a Thaise). Só a sugestão da IA lê.
   */
  aiProIds: uuid("ai_pro_ids").array(),
  aiProScope: text("ai_pro_scope").$type<"sempre" | "metodo">(),
  /** Serviços (0052): "A IA pode citar" (padrão sim). Não = item interno ou sem especialista: fica fora da lista de serviços e preços da IA. */
  aiCitavel: boolean("ai_citavel").notNull().default(true),
  /** Serviços (0084): como o preço aparece. null = fixo; "a_partir_de" = "a partir de R$ X"; "sob_consulta" = sem valor. */
  priceKind: text("price_kind").$type<"fixo" | "a_partir_de" | "sob_consulta">(),
  /** Serviços (0084): "Pode ser feito junto com outro". null = não informado (como antes: conflito da mesma cliente vira encaixe). */
  parallelOk: boolean("parallel_ok"),
}, (t) => [
  uniqueIndex("lists_kind_label_uq").on(t.kind, t.label),
  check("lists_cost_ck", sql`${t.costCents} is null or ${t.costCents} >= 0`),
  check("lists_price_kind_check", sql`${t.priceKind} is null or ${t.priceKind} in ('fixo','a_partir_de','sob_consulta')`),
]);

export const channels = pgTable("channels", {
  id: id(),
  name: text("name").notNull(),
  instanceName: text("instance_name").notNull(),
  status: channelStatusEnum("status").notNull().default("desconectado"),
  phone: text("phone"),
  lastQrAt: timestamp("last_qr_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  /** Silêncio de avisos do canal até esta data. */
  quietUntil: timestamp("quiet_until", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("channels_instance_uq").on(t.instanceName)]);

/** Setores da Casa (Configurações › Pessoas › Setores). Nome único sem diferenciar maiúsculas. */
export const teams = pgTable("teams", {
  id: id(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("teams_name_uq").on(sql`lower(${t.name})`)]);

export const teamMembers = pgTable("team_members", {
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] })]);

export const deals = pgTable("deals", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  stageId: uuid("stage_id").notNull().references(() => stages.id),
  ownerId: uuid("owner_id").references(() => users.id),
  /** Setor da conversa (Recepção, Método Fiaes®, Serviços gerais): "Passar para setor". Nulo = sem setor. */
  teamId: uuid("team_id").references((): AnyPgColumn => teams.id),
  channelId: uuid("channel_id").references(() => channels.id),
  origin: text("origin").notNull().default("whatsapp"),
  valueCents: integer("value_cents"),
  paymentMethod: text("payment_method"),
  objectionId: uuid("objection_id").references(() => lists.id),
  lostReasonId: uuid("lost_reason_id").references(() => lists.id),
  /** Motivo "Outro" do Perdido: o texto escrito pela equipe (o `lostReasonId` aponta para "Outro"). */
  lostReasonDetail: text("lost_reason_detail"),
  observations: text("observations"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  chargeAt: timestamp("charge_at", { withTimezone: true }),
  recontactAt: timestamp("recontact_at", { withTimezone: true }),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  awaitingReplySince: timestamp("awaiting_reply_since", { withTimezone: true }),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  /** Quem respondeu por último (pessoa logada no CRM ou assinatura do celular) e por onde: "Dona: Sara · respondida por Cati". */
  lastReplyById: uuid("last_reply_by_id").references(() => users.id),
  lastReplyVia: text("last_reply_via").$type<"celular" | "crm">(),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: uuid("archived_by").references(() => users.id),
  archivedStageId: uuid("archived_stage_id").references(() => stages.id),
  /** Conversa arquivada (atendimento terminado): sai da Fila sem virar "não é cliente"; volta sozinha quando a cliente ou a Casa escreve. */
  conversationArchivedAt: timestamp("conversation_archived_at", { withTimezone: true }),
  sourceId: uuid("source_id").references(() => leadSources.id),
  sourceLabel: text("source_label"),
  serviceId: uuid("service_id").references(() => lists.id),
  /** Quem vai fazer o serviço no horário marcado (Agendar). */
  professionalId: uuid("professional_id").references((): AnyPgColumn => professionals.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidCents: integer("paid_cents"),
  /** confirmado | compareceu | faltou | remarcou (validado no domínio). */
  attendance: text("attendance"),
  attendanceAt: timestamp("attendance_at", { withTimezone: true }),
  /** Aguardando cliente / Orçamento enviado: em que tentativa está (0 = fora dessas etapas; 1–3; 4 = as 3 feitas, esperando a última resposta). */
  followupAttempt: smallint("followup_attempt").notNull().default(0),
  /** Quando vence a tentativa atual (com as 3 feitas: quando vira Perdido "Não respondeu mais"). */
  followupDueAt: timestamp("followup_due_at", { withTimezone: true }),
  /** A próxima ação que representa a tentativa atual (a equipe pode trocar; a varredura adota a nova). */
  followupTaskId: uuid("followup_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
  /** "Resolvido (não precisa responder)": quando e quem encerrou a espera sem mandar mensagem. Vale até a cliente escrever de novo. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: uuid("resolved_by_id").references(() => users.id),
  /** Quando a conversa foi aberta por último por quem cuida dela (a dona, ou qualquer pessoa se não tem dona): as mensagens da cliente depois disso são as "não lidas" da Fila. */
  seenAt: timestamp("seen_at", { withTimezone: true }),
  /** "Marcar como não lida" (Fase B): a conversa fica como não lida na Fila até alguém abrir (a abertura limpa). */
  markedUnreadAt: timestamp("marked_unread_at", { withTimezone: true }),
  markedUnreadBy: uuid("marked_unread_by"),
  createdAt: createdAt(),
}, (t) => [
  index("deals_stage_idx").on(t.stageId),
  index("deals_contact_idx").on(t.contactId),
  index("deals_owner_idx").on(t.ownerId),
  // Relatórios por período (criados e fechados no intervalo).
  index("deals_created_at_idx").on(t.createdAt),
  index("deals_closed_at_idx").on(t.closedAt),
  // Nunca dois leads abertos para o mesmo contato.
  uniqueIndex("deals_one_open_per_contact").on(t.contactId).where(sql`${t.closedAt} is null and ${t.archivedAt} is null`),
]);

/** Reações do WhatsApp numa mensagem (a última de cada lado). Não são mensagens nem abrem espera. */
export type MessageReactions = { cliente?: string; casa?: string };
/** Ligação do WhatsApp (kind "call"): atendida/perdida/recusada, vídeo e a duração quando deu para calcular. Ver src/lib/calls.ts. */
export type { CallInfo } from "../../lib/calls";

export const messages = pgTable("messages", {
  id: id(),
  dealId: uuid("deal_id").references(() => deals.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  channelId: uuid("channel_id").references(() => channels.id),
  externalId: text("external_id"),
  direction: directionEnum("direction").notNull(),
  kind: text("kind").notNull().default("text"),
  body: text("body"),
  mediaUrl: text("media_url"),
  /** Nó de mídia do WhatsApp ({ key, message }) para baixar o arquivo depois; miniatura incluída. */
  media: jsonb("media").$type<{ key: Record<string, unknown>; message: Record<string, unknown> }>(),
  /** Arquivo baixado (relativo a MEDIA_DIR) e tipo. */
  mediaPath: text("media_path"),
  mediaMime: text("media_mime"),
  mediaAttempts: smallint("media_attempts").notNull().default(0),
  mediaPurgedAt: timestamp("media_purged_at", { withTimezone: true }),
  /** Áudio: duração real em segundos (ffprobe). */
  mediaDurationSec: smallint("media_duration_sec"),
  /** Áudio: cópia .m4a (AAC) ao lado do original, que toca em qualquer navegador (Safari não toca ogg/opus). Relativo a MEDIA_DIR. */
  playbackPath: text("playback_path"),
  /** Áudio: transcrição em português (faster-whisper). Áudio longo: só os 10 primeiros minutos. */
  transcript: text("transcript"),
  /** pendente | pronta | falhou | sem_fala. Null: ainda não entrou na fila (ou o transcritor não está instalado). */
  transcriptStatus: text("transcript_status").$type<"pendente" | "pronta" | "falhou" | "sem_fala">(),
  transcriptAttempts: smallint("transcript_attempts").notNull().default(0),
  /** A cliente editou/apagou a mensagem no WhatsApp. */
  editedAt: timestamp("edited_at", { withTimezone: true }),
  /** Trecho da mensagem que esta responde (citação do WhatsApp). */
  quotedBody: text("quoted_body"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /** "Apagar só aqui": some da conversa no CRM; o WhatsApp da cliente não muda. */
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  status: text("status").notNull().default("sent"),
  sentByUserId: uuid("sent_by_user_id").references(() => users.id),
  /** Por onde saiu a mensagem da Casa: "celular" (celular ou ChatGuru) ou "crm". Automática fica null. */
  sentVia: text("sent_via").$type<"celular" | "crm">(),
  /** Reações: { cliente: "❤️", casa: "👍" }. Ver `applyReaction` em src/server/whatsapp/webhook.ts. */
  reactions: jsonb("reactions").$type<MessageReactions | null>(),
  /** Ligação (kind "call", Lote 5): status, vídeo e duração. Ver `recordCall` em src/server/whatsapp/webhook.ts. */
  call: jsonb("call").$type<import("../../lib/calls").CallInfo | null>(),
  fromPhone: boolean("from_phone").notNull().default(false),
  error: text("error"),
  /** Trazida do "Exportar conversa" do WhatsApp (histórico antigo): quando foi importada. Nunca abre lead, aviso, prazo ou não lida. */
  importedAt: timestamp("imported_at", { withTimezone: true }),
  /** Chave da linha no arquivo exportado (hash): reimportar o mesmo arquivo não duplica. */
  importKey: text("import_key"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("messages_import_key_uq").on(t.contactId, t.importKey).where(sql`${t.importKey} is not null`),
  uniqueIndex("messages_external_uq").on(sql`coalesce(${t.channelId}::text, '')`, t.externalId).where(sql`${t.externalId} is not null`),
  index("messages_deal_idx").on(t.dealId, t.createdAt),
  // Relatórios por período e histórico do contato (a conversa unificada pelo número).
  index("messages_created_at_idx").on(t.createdAt),
  index("messages_contact_created_idx").on(t.contactId, t.createdAt),
  // "Equipe agora": a última resposta de cada pessoa.
  index("messages_sent_by_idx").on(t.sentByUserId, t.createdAt),
  // Worker de áudio: só os que ainda esperam conversão/transcrição.
  index("messages_audio_pending_idx").on(t.createdAt).where(sql`${t.kind} = 'audio' and ${t.mediaPath} is not null and (${t.transcriptStatus} is null or ${t.transcriptStatus} in ('pendente', 'falhou'))`),
]);

export const dealEvents = pgTable("deal_events", {
  id: id(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("deal_events_deal_idx").on(t.dealId, t.createdAt), index("deal_events_type_idx").on(t.type, t.createdAt)]);

export const alerts = pgTable("alerts", {
  id: id(),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  audience: text("audience").notNull().default("responsavel"),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("info"),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: createdAt(),
  readAt: timestamp("read_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** Chave da espera em aberto (um alerta ativo por espera). */
  waitKey: text("wait_key"),
  level: smallint("level").notNull().default(1),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("alerts_dedupe_uq").on(t.dedupeKey),
  index("alerts_user_idx").on(t.userId, t.createdAt),
  uniqueIndex("alerts_wait_uq").on(t.waitKey).where(sql`resolved_at is null and wait_key is not null`),
  // Um aviso "a cliente escreveu" aberto por conversa: mensagens chegando em paralelo (foto + texto) renovam o mesmo (upsert), nunca duplicam.
  uniqueIndex("alerts_mensagem_cliente_aberto_uq").on(t.dealId).where(sql`type = 'mensagem_cliente' and resolved_at is null`),
  // Avisos abertos de uma conversa: a Fila (atrasados), o sino e as resoluções (responder, abrir, encerrar) filtram assim.
  index("alerts_deal_aberto_idx").on(t.dealId).where(sql`resolved_at is null`),
]);

export const automations = pgTable("automations", {
  id: id(),
  key: text("key"),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>[]>().notNull().default([]),
  actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("automations_key_uq").on(t.key)]);

export const automationVersions = pgTable("automation_versions", {
  id: id(),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
});

export const automationRuns = pgTable("automation_runs", {
  id: id(),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  windowKey: text("window_key").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("automation_runs_uq").on(t.automationId, t.dealId, t.windowKey)]);

export const webhookEvents = pgTable("webhook_events", {
  id: id(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
}, (t) => [uniqueIndex("webhook_events_uq").on(t.provider, t.externalId)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const leadSources = pgTable("lead_sources", {
  id: id(),
  /** 6–12 caracteres [a-z0-9]. */
  code: text("code").notNull(),
  label: text("label").notNull(),
  /** instagram | google | panfleto | indicacao | anuncio | recepcao | outro */
  kind: text("kind").notNull(),
  prefill: text("prefill"),
  referrerContactId: uuid("referrer_contact_id").references(() => contacts.id),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("lead_sources_code_uq").on(t.code)]);

export const tasks = pgTable("tasks", {
  id: id(),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  /** proxima_acao | retorno | comparecimento | geral */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  assigneeId: uuid("assignee_id").references(() => users.id),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("tasks_done_due_idx").on(t.doneAt, t.dueAt), index("tasks_deal_idx").on(t.dealId)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
}, (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)]);

export const outbox = pgTable("outbox", {
  id: id(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  /** text | poll | media (arquivo da Biblioteca: `options.fileId`; `text` = legenda ou o nome do arquivo) */
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  /** Opções da enquete (lista) ou { values, source, ... }: `source` diz de onde veio ("automacao:<id>" | "auto_resposta") e `awaiting` / `scheduledAt` / `stage` guardam o que valia ao enfileirar, para reconferir na hora de enviar; `messageId` é a mensagem pendente criada na conversa. */
  options: jsonb("options").$type<string[] | { values?: string[]; source?: string; awaiting?: string; scheduledAt?: string; stage?: string; messageId?: string; cancelIfReply?: boolean; sendAt?: string; visitStart?: string; fileId?: string; caption?: string; visitId?: string } | null>(),
  /** pending | sending | sent | failed | cancelled */
  status: text("status").notNull().default("pending"),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  attempts: smallint("attempts").notNull().default(0),
  /** Mensagem agendada à mão: quem agendou (assina e é avisada se não sair). Automáticas ficam sem. */
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  /** Quando o status mudou pela última vez (gatilho no banco, 0047): "não saíram nas últimas 24 h" em Mensagens programadas. */
  statusAt: timestamp("status_at", { withTimezone: true }),
}, (t) => [index("outbox_status_idx").on(t.status, t.notBefore)]);

/** Biblioteca (Fase B, Task 4): arquivos da Casa para mandar em um toque ou pela fila. Apagar é lógico (`deletedAt`): o arquivo e o caminho ficam. */
export const libraryFiles = pgTable("library_files", {
  id: id(),
  name: text("name").notNull(),
  caption: text("caption"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  /** Relativo a MEDIA_DIR: `biblioteca/<id>.<ext>`. */
  path: text("path").notNull(),
  mime: text("mime").notNull(),
  /** image | video | document | audio */
  kind: text("kind").notNull(),
  sizeBytes: integer("size_bytes"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
export type LibraryFile = typeof libraryFiles.$inferSelect;

/** "Acompanhar" (Fase B): a lista pessoal de conversas de cada pessoa, no Hoje. Continua até a pessoa desmarcar. */
export const dealFollows = pgTable("deal_follows", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.dealId] }), index("deal_follows_deal_idx").on(t.dealId)]);

/**
 * Pesquisa de satisfação (Fase B, Task 9): uma linha por enquete de 1 a 5 que saiu (Depois do atendimento ou regra "Mandar a Pesquisa de
 * satisfação"), gravada no envio com as profissionais e os serviços da visita. O voto (vale o último) preenche `score`/`answeredAt`.
 */
export const satisfactionAnswers = pgTable("satisfaction_answers", {
  id: id(),
  visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  /** A mensagem da enquete (messages.id); o voto chega pelo `external_id` dela. */
  pollMessageId: uuid("poll_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  /** 1 a 5; vazio = sem resposta (ou voto retirado). */
  score: smallint("score"),
  professionalIds: uuid("professional_ids").array().notNull().default(sql`'{}'::uuid[]`),
  serviceIds: uuid("service_ids").array().notNull().default(sql`'{}'::uuid[]`),
  askedAt: timestamp("asked_at", { withTimezone: true }).notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("satisfaction_answers_poll_uq").on(t.pollMessageId),
  index("satisfaction_answers_asked_idx").on(t.askedAt),
  index("satisfaction_answers_contact_idx").on(t.contactId),
  check("satisfaction_answers_score_check", sql`${t.score} IS NULL OR ${t.score} BETWEEN 1 AND 5`),
]);

export type User = typeof users.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type ListItem = typeof lists.$inferSelect;
export type LeadSource = typeof leadSources.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type OutboxItem = typeof outbox.$inferSelect;

/** PDFs de relatório guardados (fechamento mensal gerado pelo worker; o PDF do período sai na hora e não é guardado). */
export const reportFiles = pgTable("report_files", {
  id: id(),
  kind: text("kind").notNull(), // "mensal"
  periodKey: text("period_key").notNull(), // "2026-10"
  path: text("path").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("report_files_kind_period_uq").on(t.kind, t.periodKey)]);

/** Token de uso único (5 min) para o Chromium do servidor abrir a página de impressão como quem pediu. Só o hash fica no banco. */
export const reportPrintTokens = pgTable("report_print_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Etiquetas que a equipe cria na hora, na conversa (ex.: "VIP", "Noiva"). Ficam na cliente, valem para as próximas conversas dela. */
export const tags = pgTable("tags", {
  id: id(),
  name: text("name").notNull(),
  /** Cor da etiqueta ("#8a6a2f"), escolhida em Configurações › Etiquetas. null = sem cor (neutra). */
  color: text("color"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("tags_name_uq").on(sql`lower(${t.name})`)]);

export const contactTags = pgTable("contact_tags", {
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tags_tag_idx").on(t.tagId)]);

/** Profissionais do salão (quem faz o serviço, não precisa ter login): a gestão cadastra em Configurações e escolhe ao Agendar. */
export const professionals = pgTable("professionals", {
  id: id(),
  /** Nome de tela (no Avec, o apelido: "MAIARA"). */
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  /** Nome completo e cargo (vêm do relatório de profissionais do Avec); avecId = ID de lá. Nunca CPF/banco. */
  fullName: text("full_name"),
  role: text("role"),
  avecId: text("avec_id"),
  /**
   * Horário de trabalho próprio (validado por `workHoursSchema`, src/lib/work-hours.ts): "0" (dom) a "6" (sáb), cada dia null (não trabalha)
   * ou 1 a 2 faixas ["HH:MM", "HH:MM"]. Coluna vazia = segue o horário da Casa.
   */
  workHours: jsonb("work_hours").$type<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string][] | null>>(),
  /** Cor na agenda: chave da paleta fechada (src/lib/palette.ts). */
  color: text("color"),
  /** Ordem na agenda; vazio = pelo nome, depois das que têm ordem. */
  agendaPosition: integer("agenda_position"),
  createdAt: createdAt(),
  /** Foto (seção 6.10): caminho relativo ao MEDIA_DIR da original; a miniatura quadrada fica ao lado, com "-q.webp". Nunca vai para a tela. */
  photoPath: text("photo_path"),
  /** Lote 7A: a usuária (perfil Profissional) que entra no app desta profissional. Fica depois de "Tirar acesso", para o histórico. */
  userId: uuid("user_id").references(() => users.id),
  /**
   * Assistente de outra profissional (17/10: SIDNEY é assistente de THAISE). Para a cliente, quem atende é a principal: lembrete, link da
   * cliente e IA mostram o nome dela; dentro do CRM a equipe vê "Sidney (assistente de Thaise)". Vazio = atende em nome próprio.
   */
  assistantOf: uuid("assistant_of").references((): AnyPgColumn => professionals.id, { onDelete: "set null" }),
  /** Regras da comissão desta profissional (mesmo formato de settings.comissao_regras); vazio = segue as da Casa. */
  commissionRules: jsonb("commission_rules").$type<Record<string, unknown>>(),
  /** Período do repasse da comissão: mensal (padrão) | quinzenal | semanal (domingo a sábado). */
  payoutPeriod: text("payout_period").notNull().default("mensal"),
  /** Dados fiscais (0071). Vínculo: parceira (salão-parceiro, Lei 13.352/2016) | clt | outro; vazio = não informado. */
  bond: text("bond"),
  /** CNPJ da parceira, só os 14 dígitos. */
  cnpj: text("cnpj"),
  /** Razão social da parceira, como vai na nota. */
  legalName: text("legal_name"),
}, (t) => [
  uniqueIndex("professionals_user_uq").on(t.userId).where(sql`${t.userId} is not null`),
  check("professionals_bond_ck", sql`${t.bond} is null or ${t.bond} in ('parceira', 'clt', 'outro')`),
  check("professionals_cnpj_ck", sql`${t.cnpj} is null or ${t.cnpj} ~ '^[0-9]{14}$'`),
]);

/** Que serviços (Listas › Serviços) cada profissional faz. `source`: manual (feito na tela) | avec_historico (sugestão aceita). */
export const professionalServices = pgTable("professional_services", {
  professionalId: uuid("professional_id").notNull().references(() => professionals.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("manual"),
  createdAt: createdAt(),
  createdBy: uuid("created_by").references(() => users.id),
  /** Lote 6C: comissão em pontos-base (4000 = 40%); vazio = sem regra. Fica vazia até a Casa preencher. */
  commissionBp: integer("commission_bp"),
  /** 0084 (Fase C item 24): preço (centavos) e tempo (min) próprios dela neste serviço. Vazio = os do serviço. */
  priceCents: integer("price_cents"),
  durationMin: smallint("duration_min"),
  /** Fase A: % da assistente (pontos-base) sobre o serviço desta profissional; vazio = assistente sem regra. */
  assistantBp: integer("assistant_bp"),
}, (t) => [
  primaryKey({ columns: [t.professionalId, t.serviceId] }), check("professional_services_commission_ck", sql`${t.commissionBp} between 0 and 10000`),
  check("professional_services_assistant_ck", sql`${t.assistantBp} between 0 and 10000`),
  check("professional_services_price_ck", sql`${t.priceCents} is null or ${t.priceCents} >= 0`),
  check("professional_services_duration_ck", sql`${t.durationMin} is null or ${t.durationMin} between 5 and 720`),
]);

/** O que o ChatGuru mandou (diálogo "Post para URL"), cru, um registro por chat: para reprocessar e auditar a importação. */
export const chatguruRecords = pgTable("chatguru_records", {
  chatId: text("chat_id").primaryKey(),
  phone: text("phone"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  error: text("error"),
});

/** Notas internas da conversa: a cliente nunca vê. Troca de turno, recado com @, anotações trazidas do ChatGuru e a escolha no menu de boas-vindas. Ficam na cliente (todas as conversas dela). */
export const contactNotes = pgTable("contact_notes", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
  authorId: uuid("author_id").references(() => users.id),
  /** Quem escreveu quando não é alguém da equipe daqui ("SARA" do ChatGuru, "Menu de boas-vindas"). */
  authorName: text("author_name"),
  body: text("body").notNull(),
  mentions: uuid("mentions").array().notNull().default(sql`'{}'::uuid[]`),
  /** crm | chatguru | menu */
  source: text("source").notNull().default("crm"),
  /** Importação idempotente: a mesma anotação do ChatGuru nunca entra duas vezes. */
  externalKey: text("external_key"),
  /** "Anotar o que foi falado" numa ligação (Lote 5): a ligação (messages, kind "call") e o assunto. */
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  subject: text("subject"),
  createdAt: createdAt(),
}, (t) => [
  index("contact_notes_contact_idx").on(t.contactId, t.createdAt),
  index("contact_notes_message_idx").on(t.messageId).where(sql`${t.messageId} is not null`),
  uniqueIndex("contact_notes_external_uq").on(t.externalKey).where(sql`${t.externalKey} is not null`),
]);

/** Mensagem em massa (Contatos). Nasce desligada: precisa da chave `envio_massa` e da permissão "mensagem.massa". */
export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  /** rascunho | agendada | enviando | pausada | concluida | cancelada */
  status: text("status").notNull().default("rascunho"),
  intervalSeconds: integer("interval_seconds").notNull().default(180),
  /** O filtro de Contatos usado ao montar a lista (só para conferência). */
  audience: jsonb("audience").$type<Record<string, unknown>>().notNull().default({}),
  total: integer("total").notNull().default(0),
  startAt: timestamp("start_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("campaigns_status_idx").on(t.status, t.createdAt)]);

/** Quem recebe cada mensagem em massa: lista congelada ao montar. `sentAt` = quando tentou (enviada, falhou ou reservada). */
export const campaignRecipients = pgTable("campaign_recipients", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  /** pendente | enviando | enviada | falhou | pulada */
  status: text("status").notNull().default("pendente"),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.campaignId, t.contactId] }),
  index("campaign_recipients_status_idx").on(t.campaignId, t.status),
  index("campaign_recipients_sent_idx").on(t.sentAt),
]);

export type ContactNote = typeof contactNotes.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;

/* ───────────────────────── Avec: agenda, pacotes, vendas e relatórios (migration 0022) ───────────────────────── */

const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * A visita (Lote 6B): a cliente vem num dia. Junta os serviços daquele dia, a comanda (6C) e o link de confirmação (7B). Horário do Avec
 * só ganha visita quando alguém mexe nele no CRM (`ensureVisitFor`). `requestKey` = idempotência do formulário Marcar.
 */
export const visits = pgTable("visits", {
  id: id(),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  /** Dia em Salvador ("AAAA-MM-DD"). */
  day: date("day").notNull(),
  dealId: uuid("deal_id").references(() => deals.id),
  notes: text("notes"),
  /** crm | avec | online */
  origin: text("origin").notNull().default("crm"),
  requestKey: text("request_key"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("visits_request_key_uq").on(t.requestKey).where(sql`${t.requestKey} is not null`),
  index("visits_contact_day_idx").on(t.contactId, t.day),
  index("visits_day_idx").on(t.day),
]);

/**
 * Horários marcados (agenda da Casa): vindos do Avec (reservas, cancelamentos, lista de espera) ou criados no CRM.
 * status: espera | solicitado | agendado | confirmado | chegou | em_atendimento | compareceu (Finalizado) | faltou | cancelado | espera_encaixada | espera_desistiu (src/lib/appointment-status.ts).
 * `avecStatus` guarda o texto original quando não reconhecido.
 * `externalKey` (avec:res:<aaaa-mm-ddTHH:MM>|<cliente>|<serviço>) impede duplicar ao importar de novo.
 */
/** 0080: os marcadores do horário (a etiqueta do horário; "Etiqueta" já é da cliente). Nome único sem diferenciar maiúsculas. */
export const appointmentLabels = pgTable("appointment_labels", {
  id: id(),
  name: text("name").notNull(),
  color: text("color"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("appointment_labels_name_uq").on(sql`lower(${t.name})`)]);

/**
 * 0085 (item 23a): a série de um horário que se repete a cada `everyWeeks` semanas, `times` vezes. O CHECK é só de sanidade (1..52 e 2..104):
 * os limites da Casa ficam em settings `repetir` e valem no domínio. `requestKey` impede criar a mesma série duas vezes.
 */
export const appointmentSeries = pgTable("appointment_series", {
  id: id(),
  everyWeeks: smallint("every_weeks").notNull(),
  times: smallint("times").notNull(),
  requestKey: uuid("request_key").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("appointment_series_request_uq").on(t.requestKey),
  check("appointment_series_every_weeks_check", sql`${t.everyWeeks} between 1 and 52`),
  check("appointment_series_times_check", sql`${t.times} between 2 and 104`),
]);

export const appointments = pgTable("appointments", {
  id: id(),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  professionalId: uuid("professional_id").references(() => professionals.id),
  serviceId: uuid("service_id").references(() => lists.id),
  serviceLabel: text("service_label").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMin: smallint("duration_min"),
  status: text("status").notNull(),
  avecStatus: text("avec_status"),
  priceCents: integer("price_cents"),
  notes: text("notes"),
  origin: text("origin").notNull().default("avec"),
  createdByName: text("created_by_name"),
  dealId: uuid("deal_id").references(() => deals.id),
  externalKey: text("external_key").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  /* Lote 6B (0026): visita, ciclo de vida, encaixe, gêmeo do Avec e lista de espera. */
  visitId: uuid("visit_id").references(() => visits.id),
  bufferMin: smallint("buffer_min"),
  fitIn: boolean("fit_in").notNull().default(false),
  fitInBy: uuid("fit_in_by").references(() => users.id),
  outsideHours: boolean("outside_hours").notNull().default(false),
  /** Marcado com "Qualquer uma" (o sistema escolheu a profissional). */
  anyPro: boolean("any_pro").notNull().default(false),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** recepcao | link | enquete */
  confirmedVia: text("confirmed_via"),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  /** cliente_desmarcou | casa_desmarcou | nao_confirmou | engano | remarcado | recusado | outro */
  cancelReason: text("cancel_reason"),
  cancelNote: text("cancel_note"),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  /** recepcao | link | avec */
  cancelledVia: text("cancelled_via"),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  /** Mexido no CRM: a importação do Avec não toca mais (só grava `avecStatus`). */
  crmTouchedAt: timestamp("crm_touched_at", { withTimezone: true }),
  /** Reserva do Avec que é o mesmo horário de um registro do CRM: some da grade, não ocupa e não entra no funil. */
  avecTwinOf: uuid("avec_twin_of").references((): AnyPgColumn => appointments.id),
  /**
   * 0060 (18/10): o Avec deu sinal sobre este horário mas a importação não teve certeza e não mexeu; aparece em "Conferir com o Avec"
   * enquanto o horário estiver sem desfecho. `venda_sem_par`: venda da cliente no dia que não bate com a profissional nem com o serviço
   * (ou pagamento sem hora). `atendimento_longe`: "Atendimento" do lead com horário do Avec no mesmo dia, a mais de 2 h.
   */
  avecReview: text("avec_review"),
  /**
   * 0060 (gap Avec, A1): a última importação do 0248 "Agendamentos por status › Agendado" que trazia esta reserva, ou seja, no Avec ela
   * continua Agendado, sem baixa. Sinal de conferência ("Sem desfecho" e "Conferir com o Avec"); some quando o 0248 do período não a traz.
   */
  avecUnclosedAt: timestamp("avec_unclosed_at", { withTimezone: true }),
  /** Lista de espera: manha | tarde | dia */
  waitWindow: text("wait_window"),
  waitResultAppointmentId: uuid("wait_result_appointment_id").references((): AnyPgColumn => appointments.id),
  /** 6.11: a cliente escolheu a profissional (`escolhida`) ou tanto faz (`sem_preferencia`); null = não informado. */
  preference: text("preference"),
  /** 0080: marcador do horário (VER OBS, Não Cobrar…) e tipo (indicacao | noiva). Só do CRM: não marcam `crmTouchedAt`. "Primeira vez" não é gravado. */
  labelId: uuid("label_id").references(() => appointmentLabels.id, { onDelete: "set null" }),
  visitType: text("visit_type"),
  /** 0085: a série do horário que se repete (só do CRM: não marca `crmTouchedAt`). */
  seriesId: uuid("series_id").references(() => appointmentSeries.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("appointments_external_uq").on(t.externalKey),
  index("appointments_starts_idx").on(t.startsAt),
  index("appointments_contact_idx").on(t.contactId),
  index("appointments_professional_idx").on(t.professionalId),
  index("appointments_pro_starts_idx").on(t.professionalId, t.startsAt),
  index("appointments_visit_idx").on(t.visitId),
  index("appointments_contact_starts_idx").on(t.contactId, t.startsAt),
  index("appointments_twin_idx").on(t.avecTwinOf).where(sql`${t.avecTwinOf} is not null`),
  index("appointments_series_idx").on(t.seriesId).where(sql`${t.seriesId} is not null`),
]);

/**
 * Auxiliares do horário (0089, 20/10): quem ajuda a principal naquele serviço, na ordem escolhida (posição 1, 2…). A auxiliar ocupa a
 * agenda dela no mesmo período do horário (o motor confere conflito), aparece na grade com o selo "auxiliar de <principal>" e vira
 * assistente do item quando a comanda abre (até o limite do Caixa). Remarcar leva junto; cancelar libera (o status do horário manda).
 */
export const appointmentAssistants = pgTable("appointment_assistants", {
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  position: smallint("position").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ name: "appointment_assistants_pk", columns: [t.appointmentId, t.professionalId] }),
  check("appointment_assistants_position_ck", sql`${t.position} between 1 and 20`),
  uniqueIndex("appointment_assistants_position_uq").on(t.appointmentId, t.position),
  index("appointment_assistants_pro_idx").on(t.professionalId),
]);

/**
 * Bloqueios de agenda (almoço, folga, compromisso). weekdays: 0=dom..6=sáb; null = todos os dias do intervalo. Horários "HH:MM" de Salvador.
 * origin: avec (importado) | crm (criado aqui, external_key "crm:blq:<uuid>"). Apagar só marca `deleted_at` (vale também para os do Avec).
 */
export const agendaBlocks = pgTable("agenda_blocks", {
  id: id(),
  professionalId: uuid("professional_id").references(() => professionals.id),
  title: text("title").notNull(),
  notes: text("notes"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  weekdays: smallint("weekdays").array(),
  externalKey: text("external_key").notNull(),
  createdAt: createdAt(),
  origin: text("origin").notNull().default("avec"),
  /** almoco | folga | atestado | feriado | curso | outro (os do Avec ficam vazios) */
  reason: text("reason"),
  createdBy: uuid("created_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  updatedBy: uuid("updated_by").references(() => users.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by").references(() => users.id),
  /** Lote 7A: pedido de folga da profissional. null = bloqueio normal; pedido (só avisa no motor) | aprovado (bloqueia) | recusado. */
  requestStatus: text("request_status").$type<"pedido" | "aprovado" | "recusado">(),
  requestedBy: uuid("requested_by").references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
}, (t) => [
  uniqueIndex("agenda_blocks_external_uq").on(t.externalKey), index("agenda_blocks_range_idx").on(t.startsOn, t.endsOn),
  index("agenda_blocks_live_idx").on(t.startsOn, t.endsOn).where(sql`${t.deletedAt} is null`),
]);

/** Pacotes comprados pela cliente (sessões usadas / total, validade). */
export const clientPackages = pgTable("client_packages", {
  id: id(),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  packageName: text("package_name").notNull(),
  serviceLabel: text("service_label"),
  totalSessions: integer("total_sessions").notNull(),
  usedSessions: integer("used_sessions").notNull().default(0),
  priceCents: integer("price_cents"),
  purchasedOn: date("purchased_on"),
  validUntil: date("valid_until"),
  origin: text("origin").notNull().default("avec"),
  externalKey: text("external_key").notNull(),
  /** Lote 6C: vendido pela comanda (`crm:pac:<item>:<serviço>`). `unitCents` = valor por sessão (base da comissão). */
  packageDefId: uuid("package_def_id").references((): AnyPgColumn => packageDefs.id),
  comandaItemId: uuid("comanda_item_id").references((): AnyPgColumn => comandaItems.id),
  unitCents: integer("unit_cents"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("client_packages_external_uq").on(t.externalKey), index("client_packages_contact_idx").on(t.contactId)]);

/** Cada sessão de pacote usada (data, item, profissional, comanda). */
export const packageUses = pgTable("package_uses", {
  id: id(),
  clientPackageId: uuid("client_package_id").references(() => clientPackages.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  usedOn: date("used_on").notNull(),
  item: text("item").notNull(),
  professionalName: text("professional_name"),
  comanda: text("comanda"),
  /** Lote 6C: sessão usada pela comanda (`crm:uso:<item>`). */
  comandaItemId: uuid("comanda_item_id").references((): AnyPgColumn => comandaItems.id),
  professionalId: uuid("professional_id").references(() => professionals.id),
  origin: text("origin").notNull().default("avec"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  externalKey: text("external_key").notNull(),
}, (t) => [uniqueIndex("package_uses_external_uq").on(t.externalKey), index("package_uses_contact_idx").on(t.contactId)]);

/** O caixa de cada pessoa (Plano 3: um aberto POR PESSOA). `expected`/`counted` por forma de pagamento, em centavos. */
export const cashSessions = pgTable("cash_sessions", {
  id: id(),
  day: date("day").notNull(),
  /** aberto | fechado */ status: text("status").notNull().default("aberto"),
  openingCents: integer("opening_cents").notNull().default(0),
  openedBy: uuid("opened_by").notNull().references(() => users.id),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: uuid("closed_by").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  expected: jsonb("expected").$type<Record<string, number>>(),
  counted: jsonb("counted").$type<Record<string, number>>(),
  differenceCents: integer("difference_cents"),
  notes: text("notes"),
  reopenedBy: uuid("reopened_by").references(() => users.id),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  /** Dinheiro contado por cédula e moeda: centavos da cédula → quantidade (0055). */
  countedBreakdown: jsonb("counted_breakdown").$type<Record<string, number>>(),
  /** Quem da gestão aprovou a diferença acima da tolerância. */
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  /** Fechado com contagem cega (quem contou não viu o esperado). */
  blind: boolean("blind").notNull().default(false),
}, (t) => [uniqueIndex("cash_sessions_one_open_per_person").on(t.openedBy).where(sql`${t.status} = 'aberto'`)]);

/** "Outra forma" de pagamento, cadastrada pela gestão em Serviços e pacotes › Formas de pagamento (0055). */
export const paymentMethodOptions = pgTable("payment_method_options", {
  id: id(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("payment_method_options_label_uq").on(sql`lower(${t.label})`)]);

export const cashMovements = pgTable("cash_movements", {
  id: id(),
  cashSessionId: uuid("cash_session_id").notNull().references(() => cashSessions.id),
  /** sangria | suprimento */ kind: text("kind").notNull(),
  valueCents: integer("value_cents").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
}, (t) => [check("cash_movements_value_ck", sql`${t.valueCents} > 0`)]);

export type PackageDefItem = { serviceId: string; sessions: number; unitCents: number | null };
/** Pacotes à venda (Caixa › Pacotes): nome, preço, validade e serviços × sessões (valor por sessão opcional). */
export const packageDefs = pgTable("package_defs", {
  id: id(),
  name: text("name").notNull(),
  priceCents: integer("price_cents"),
  validityDays: integer("validity_days"),
  items: jsonb("items").$type<PackageDefItem[]>().notNull(),
  /** Aba Serviços › Pacotes (0045): o que inclui, para a IA explicar o pacote. */
  description: text("description"),
  /** Nome do pacote no Avec (0045): liga o pacote importado (scripts/pacotes-do-avec.ts) mesmo depois de renomeado. */
  avecName: text("avec_name"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A conta da cliente: "Comanda 12 de 16/10". Uma aberta por visita. */
export const comandas = pgTable("comandas", {
  id: id(),
  day: date("day").notNull(),
  number: integer("number").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  visitId: uuid("visit_id").references(() => visits.id),
  /** aberta | fechada | cancelada */ status: text("status").notNull().default("aberta"),
  discountCents: integer("discount_cents").notNull().default(0),
  subtotalCents: integer("subtotal_cents"),
  totalCents: integer("total_cents"),
  paidCents: integer("paid_cents"),
  changeCents: integer("change_cents"),
  cashSessionId: uuid("cash_session_id").references(() => cashSessions.id),
  requestKey: text("request_key"),
  openedBy: uuid("opened_by").notNull().references(() => users.id),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: uuid("closed_by").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** CPF na nota (opcional, só os 11 dígitos). */ cpf: text("cpf"),
  /** Escolha da recepção ao receber: "nao" (não emitir), "sem_cpf" ou "com_cpf". Null = ainda não escolheu (vale o padrão da Casa). */ notaEscolha: text("nota_escolha"),
  discountReason: text("discount_reason"),
  reopenedBy: uuid("reopened_by").references(() => users.id),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason"),
  /** Quanto a cliente ainda deve desta comanda (Fase A: "deixar como dívida"). */
  debtCents: integer("debt_cents").notNull().default(0),
}, (t) => [
  check("comandas_debt_ck", sql`${t.debtCents} >= 0`),
  check("comandas_cpf_ck", sql`${t.cpf} is null or ${t.cpf} ~ '^[0-9]{11}$'`),
  check("comandas_nota_escolha_ck", sql`${t.notaEscolha} is null or ${t.notaEscolha} in ('nao', 'sem_cpf', 'com_cpf')`),
  uniqueIndex("comandas_day_number_uq").on(t.day, t.number),
  uniqueIndex("comandas_open_visit_uq").on(t.visitId).where(sql`${t.status} = 'aberta' and ${t.visitId} is not null`),
  uniqueIndex("comandas_request_key_uq").on(t.requestKey).where(sql`${t.requestKey} is not null`),
]);

export const comandaItems = pgTable("comanda_items", {
  id: id(),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id),
  /** servico | produto | pacote_venda | pacote_sessao */ kind: text("kind").notNull(),
  label: text("label").notNull(),
  serviceId: uuid("service_id").references(() => lists.id),
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  professionalId: uuid("professional_id").references(() => professionals.id),
  qty: numeric("qty", { mode: "number" }).notNull().default(1),
  /** null = preço não informado: não fecha. */ unitCents: integer("unit_cents"),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents"),
  clientPackageId: uuid("client_package_id").references(() => clientPackages.id),
  packageDefId: uuid("package_def_id").references(() => packageDefs.id),
  /** Retrato no fechamento: mudar a regra depois não mexe no que fechou. */
  commissionBp: integer("commission_bp"),
  commissionBaseCents: integer("commission_base_cents"),
  commissionCents: integer("commission_cents"),
  addedBy: uuid("added_by").references(() => users.id),
  /** recepcao | profissional */ addedVia: text("added_via").notNull().default("recepcao"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  /** Preço anterior (catálogo ou horário) quando alguém muda o preço; o motivo fica ao lado (0055). */
  originalUnitCents: integer("original_unit_cents"),
  priceReason: text("price_reason"),
  discountReason: text("discount_reason"),
  /** Para a nota fiscal futura: servico (NFS-e) | produto (NFC-e). */
  fiscalKind: text("fiscal_kind").notNull().default("servico"),
  /** Produto do catálogo (kind = produto); null nos itens antigos e com Produtos e estoque desligado (0091). */
  productId: uuid("product_id").references((): AnyPgColumn => products.id),
  /** Retrato no fechamento (0092): o valor do item na nota = total − a parte dele no desconto da comanda − a parte dele na cortesia. */
  netCents: integer("net_cents"),
  /** Retrato no fechamento: CNPJ da profissional quando o vínculo dela é parceira. */
  partnerCnpj: text("partner_cnpj"),
  /** Fase A: comissão sem descontos, cada desconto aplicado (retrato) e o recibo que a pagou. */
  commissionGrossCents: integer("commission_gross_cents"),
  commissionDeductions: jsonb("commission_deductions").$type<Deductions>(),
  payoutId: uuid("payout_id").references((): AnyPgColumn => commissionPayouts.id),
  /** Item "Dívida da comanda N" (kind divida): qual comanda ele quita. */
  settlesComandaId: uuid("settles_comanda_id").references((): AnyPgColumn => comandas.id),
  /** Comissão retida até a dívida da comanda zerar (regra "quando ela pagar"). */
  commissionHeld: boolean("commission_held").notNull().default(false),
}, (t) => [
  index("comanda_items_payout_idx").on(t.payoutId),
  check("comanda_items_fiscal_kind_ck", sql`${t.fiscalKind} in ('servico', 'produto')`),
  index("comanda_items_comanda_idx").on(t.comandaId),
  index("comanda_items_pro_idx").on(t.professionalId, t.createdAt),
  index("comanda_items_appointment_idx").on(t.appointmentId),
]);

export const comandaPayments = pgTable("comanda_payments", {
  id: id(),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id),
  /** pix | credito | debito | dinheiro | cortesia | credito_cliente | outra */ method: text("method").notNull(),
  /** O que foi entregue (no dinheiro, pode passar do restante; a diferença é o troco). */
  valueCents: integer("value_cents").notNull(),
  installments: smallint("installments"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  /** O caixa de quem recebeu (null: recebido sem caixa aberto). */
  cashSessionId: uuid("cash_session_id").references(() => cashSessions.id),
  /** Bandeira do cartão (crédito e débito; catálogo fechado em comanda-math). */ brand: text("brand"),
  note: text("note"),
  customMethodId: uuid("custom_method_id").references(() => paymentMethodOptions.id),
  /** Troco devolvido deste pagamento em dinheiro (gravado ao fechar a comanda). */
  changeCents: integer("change_cents").notNull().default(0),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
  /** Taxa do cartão no momento do pagamento (retrato): % em pontos-base e valor. Vazio = não é cartão ou sem taxa cadastrada. */
  feeBp: integer("fee_bp"),
  feeCents: integer("fee_cents"),
}, (t) => [
  check("comanda_payments_fee_ck", sql`${t.feeCents} is null or (${t.feeCents} >= 0 and ${t.feeCents} <= ${t.valueCents})`),
  index("comanda_payments_comanda_idx").on(t.comandaId), index("comanda_payments_session_idx").on(t.cashSessionId),
  check("comanda_payments_value_ck", sql`${t.valueCents} > 0`),
  check("comanda_payments_change_ck", sql`${t.changeCents} >= 0 and ${t.changeCents} <= ${t.valueCents}`),
]);

/** Crédito da cliente: saldo = soma dos lançamentos. reason: troco | pagamento | estorno | ajuste | saldo_avec. */
export const clientCreditEntries = pgTable("client_credit_entries", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  deltaCents: integer("delta_cents").notNull(),
  reason: text("reason").notNull(),
  comandaId: uuid("comanda_id").references(() => comandas.id),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("client_credit_contact_idx").on(t.contactId), check("client_credit_delta_ck", sql`${t.deltaCents} <> 0`)]);

/** Taxa do cartão da Casa por forma (credito | debito), bandeira e parcelado (2x ou mais). Cada pagamento guarda o retrato da taxa. */
export const paymentFees = pgTable("payment_fees", {
  id: id(),
  method: text("method").notNull(),
  brand: text("brand").notNull(),
  parcelado: boolean("parcelado").notNull().default(false),
  feeBp: integer("fee_bp").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payment_fees_uq").on(t.method, t.brand, t.parcelado),
  check("payment_fees_method_ck", sql`${t.method} in ('credito', 'debito')`),
  check("payment_fees_parcelado_ck", sql`${t.method} = 'credito' or not ${t.parcelado}`),
  check("payment_fees_bp_ck", sql`${t.feeBp} between 0 and 10000`),
]);

/** Pagamento da comissão (recibo numerado). Desfazer = cancelled_at com motivo; tudo volta ao "A pagar". */
export const commissionPayouts = pgTable("commission_payouts", {
  id: id(),
  number: integer("number").notNull().default(sql`nextval('commission_payouts_number_seq')`),
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  fromDay: date("from_day"),
  untilDay: date("until_day").notNull(),
  commissionCents: integer("commission_cents").notNull().default(0),
  bonusCents: integer("bonus_cents").notNull().default(0),
  valesCents: integer("vales_cents").notNull().default(0),
  descontosCents: integer("descontos_cents").notNull().default(0),
  carriedCents: integer("carried_cents").notNull().default(0),
  netCents: integer("net_cents").notNull().default(0),
  note: text("note"),
  paidBy: uuid("paid_by").notNull().references(() => users.id),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
  /** O recibo congelado no pagamento (linhas, lançamentos e pendências como foram pagos); lido mesmo depois de desfeito. */
  receipt: jsonb("receipt").$type<Record<string, unknown>>(),
}, (t) => [
  uniqueIndex("commission_payouts_number_uq").on(t.number),
  index("commission_payouts_pro_idx").on(t.professionalId, t.untilDay),
]);

/** Assistentes de um item de serviço (até 2) e o retrato da comissão de cada uma ao Finalizar. */
export const comandaItemAssistants = pgTable("comanda_item_assistants", {
  id: id(),
  comandaItemId: uuid("comanda_item_id").notNull().references(() => comandaItems.id, { onDelete: "cascade" }),
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  position: smallint("position").notNull(),
  baseCents: integer("base_cents"),
  bp: integer("bp"),
  commissionCents: integer("commission_cents"),
  payoutId: uuid("payout_id").references(() => commissionPayouts.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("comanda_item_assistants_position_ck", sql`${t.position} in (1, 2)`),
  uniqueIndex("comanda_item_assistants_position_uq").on(t.comandaItemId, t.position),
  uniqueIndex("comanda_item_assistants_pro_uq").on(t.comandaItemId, t.professionalId),
  index("comanda_item_assistants_pro_idx").on(t.professionalId),
  index("comanda_item_assistants_payout_idx").on(t.payoutId),
]);

/** Vale, bônus ou desconto "todo mês no dia X" (1 a 28). Os lançamentos do mês são gerados na hora de ler ou pagar. */
export const professionalAdjustmentRules = pgTable("professional_adjustment_rules", {
  id: id(),
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  /** vale | bonus | desconto */ kind: text("kind").notNull(),
  valueCents: integer("value_cents").notNull(),
  dayOfMonth: smallint("day_of_month").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  note: text("note").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("professional_adjustment_rules_kind_ck", sql`${t.kind} in ('vale', 'bonus', 'desconto')`),
  check("professional_adjustment_rules_value_ck", sql`${t.valueCents} > 0`),
  check("professional_adjustment_rules_day_ck", sql`${t.dayOfMonth} between 1 and 28`),
  index("professional_adjustment_rules_pro_idx").on(t.professionalId),
]);

/** Vale, bônus ou desconto na comissão lançado numa profissional (motivo obrigatório). O vale pode vir de uma sangria do caixa. */
export const professionalAdjustments = pgTable("professional_adjustments", {
  id: id(),
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  /** vale | bonus | desconto */ kind: text("kind").notNull(),
  valueCents: integer("value_cents").notNull(),
  day: date("day").notNull(),
  note: text("note").notNull(),
  ruleId: uuid("rule_id").references(() => professionalAdjustmentRules.id),
  cashMovementId: uuid("cash_movement_id").references(() => cashMovements.id),
  carriedFromPayoutId: uuid("carried_from_payout_id").references(() => commissionPayouts.id),
  payoutId: uuid("payout_id").references(() => commissionPayouts.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
}, (t) => [
  check("professional_adjustments_kind_ck", sql`${t.kind} in ('vale', 'bonus', 'desconto')`),
  check("professional_adjustments_value_ck", sql`${t.valueCents} > 0`),
  index("professional_adjustments_pro_idx").on(t.professionalId, t.day),
  index("professional_adjustments_payout_idx").on(t.payoutId),
  uniqueIndex("professional_adjustments_rule_day_uq").on(t.ruleId, t.day).where(sql`${t.ruleId} is not null`),
  uniqueIndex("professional_adjustments_movement_uq").on(t.cashMovementId).where(sql`${t.cashMovementId} is not null`),
]);

/** Dívida da cliente, por comanda: + quando fica devendo, − quando quita (paid_in_comanda_id = a comanda onde pagou). */
export const clientDebtEntries = pgTable("client_debt_entries", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id),
  deltaCents: integer("delta_cents").notNull(),
  paidInComandaId: uuid("paid_in_comanda_id").references(() => comandas.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("client_debt_contact_idx").on(t.contactId),
  index("client_debt_comanda_idx").on(t.comandaId),
  check("client_debt_delta_ck", sql`${t.deltaCents} <> 0`),
]);

export type CashSession = typeof cashSessions.$inferSelect;
export type PaymentFee = typeof paymentFees.$inferSelect;
export type ComandaItemAssistant = typeof comandaItemAssistants.$inferSelect;
export type CommissionPayout = typeof commissionPayouts.$inferSelect;
export type ProfessionalAdjustment = typeof professionalAdjustments.$inferSelect;
export type ProfessionalAdjustmentRule = typeof professionalAdjustmentRules.$inferSelect;
export type ClientDebtEntry = typeof clientDebtEntries.$inferSelect;
export type Comanda = typeof comandas.$inferSelect;
export type ComandaItem = typeof comandaItems.$inferSelect;
export type ComandaPayment = typeof comandaPayments.$inferSelect;
export type PackageDef = typeof packageDefs.$inferSelect;
export type PaymentMethodOption = typeof paymentMethodOptions.$inferSelect;

/** Itens de comanda (serviço/produto/pacote vendido). kind: servico | produto | pacote | outro. Dinheiro em centavos. */
export const salesItems = pgTable("sales_items", {
  id: id(),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  soldOn: date("sold_on").notNull(),
  comanda: text("comanda"),
  item: text("item").notNull(),
  kind: text("kind").notNull(),
  category: text("category"),
  professionalId: uuid("professional_id").references(() => professionals.id),
  professionalName: text("professional_name"),
  qty: numeric("qty", { mode: "number" }).notNull().default(1),
  valueCents: integer("value_cents"),
  discountCents: integer("discount_cents"),
  totalCents: integer("total_cents"),
  /**
   * Comissão do item: % e valor em centavos. Do Avec ("Itens de comanda": Comissão (%) e Comissão; "Comissão por item"). A comanda nova
   * do CRM (Lote 6C) grava nas MESMAS colunas. null = não informado (nunca chutar).
   */
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2, mode: "number" }),
  commissionCents: integer("commission_cents"),
  fromPackage: boolean("from_package").notNull().default(false),
  origin: text("origin").notNull().default("avec"),
  externalKey: text("external_key").notNull(),
}, (t) => [uniqueIndex("sales_items_external_uq").on(t.externalKey), index("sales_items_contact_idx").on(t.contactId, t.soldOn), index("sales_items_sold_idx").on(t.soldOn)]);

/** Pagamentos de comanda (forma de pagamento, valor). */
export const salesPayments = pgTable("sales_payments", {
  id: id(),
  contactId: uuid("contact_id").references(() => contacts.id),
  clientName: text("client_name"),
  comanda: text("comanda"),
  paidOn: date("paid_on"),
  comandaOn: date("comanda_on"),
  method: text("method"),
  valueCents: integer("value_cents").notNull(),
  externalKey: text("external_key").notNull(),
}, (t) => [uniqueIndex("sales_payments_external_uq").on(t.externalKey), index("sales_payments_contact_idx").on(t.contactId)]);

/** Relatório do Avec como chegou, JÁ SANEADO (sem CPF, RG, endereço, banco): para rever e baixar. Mesmo conteúdo não é guardado 2x. */
export const avecReports = pgTable("avec_reports", {
  id: id(),
  signature: text("signature").notNull(),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  columns: jsonb("columns").$type<string[]>().notNull(),
  rows: jsonb("rows").$type<string[][]>().notNull(),
  rowCount: integer("row_count").notNull(),
  dateFrom: date("date_from"),
  dateTo: date("date_to"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  importedBy: uuid("imported_by").references(() => users.id),
  applied: jsonb("applied").$type<Record<string, number>>().notNull().default({}),
}, (t) => [uniqueIndex("avec_reports_sig_hash_uq").on(t.signature, t.fileHash), index("avec_reports_imported_idx").on(t.importedAt)]);

/**
 * Linhas do Avec recusadas na importação (0058, 17/10): hoje, data fora do limite (o Avec mandou horários em 2029, 2923 e 4676).
 * Não viram horário; aparecem em "Conferir com o Avec" enquanto continuarem vindo nas importações (`last_seen_at`, 30 dias).
 */
export const avecRejectedRows = pgTable("avec_rejected_rows", {
  id: id(),
  externalKey: text("external_key").notNull(),
  /** data_fora_do_limite */ reason: text("reason").notNull(),
  reportId: uuid("report_id").references(() => avecReports.id, { onDelete: "set null" }),
  /** O dia como veio ("aaaa-mm-dd"). */ day: text("day").notNull(),
  hm: text("hm"),
  clientName: text("client_name"),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  professionalName: text("professional_name"),
  serviceLabel: text("service_label"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("avec_rejected_rows_key_uq").on(t.externalKey), index("avec_rejected_rows_seen_idx").on(t.lastSeenAt)]);

export type Appointment = typeof appointments.$inferSelect;
export type AgendaBlock = typeof agendaBlocks.$inferSelect;
export type ClientPackage = typeof clientPackages.$inferSelect;
export type AvecReport = typeof avecReports.$inferSelect;

/* ───────────────────────── Lote 2: visão por contato (migration 0025) ───────────────────────── */

/**
 * A "visão materializada" da ficha e da lista de Contatos: o que é pesado de contar, uma linha por contato.
 * Recalculada INTEIRA por `refreshContactStats` (src/server/domain/contact-stats.ts) depois de cada importação do Avec e toda noite.
 * Só fatos que não dependem da hora: "sumida", "na hora de voltar", "com horário" e o próximo horário são lidos ao vivo.
 * Dinheiro (total, dívida, crédito) só sai das consultas para quem tem "ver valores".
 */
export const contactStats = pgTable("contact_stats", {
  contactId: uuid("contact_id").primaryKey().references(() => contacts.id, { onDelete: "cascade" }),
  /** Dias distintos com comparecimento (Avec), comanda (Avec) ou Compareceu no CRM. */
  visits: integer("visits").notNull().default(0),
  firstVisitOn: date("first_visit_on"),
  lastVisitOn: date("last_visit_on"),
  /** Mediana dos intervalos entre visitas; só com 3 ou mais visitas. */
  rhythmDays: smallint("rhythm_days"),
  /** Ciclo de retorno do último serviço feito (Listas › Serviços), para quem ainda não tem ritmo. */
  cycleDays: smallint("cycle_days"),
  /** Última visita + ritmo (ou ciclo). */
  returnDueOn: date("return_due_on"),
  noShows: integer("no_shows").notNull().default(0),
  cancellations: integer("cancellations").notNull().default(0),
  /** Comandas distintas (dia + número): o divisor do ticket médio. */
  tickets: integer("tickets").notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }),
  /** Calculada: 3+ serviços e 60%+ com a mesma profissional. A escolhida na ficha fica em `contacts.preferred_professional_id`. */
  preferredProfessionalId: uuid("preferred_professional_id").references(() => professionals.id, { onDelete: "set null" }),
  preferredProfessionalName: text("preferred_professional_name"),
  /** Parte dos serviços com a profissional mais frequente (0 a 1), mesmo abaixo de 60%. */
  preferredShare: real("preferred_share"),
  serviceCount: integer("service_count").notNull().default(0),
  topServices: jsonb("top_services").$type<{ item: string; n: number }[]>().notNull().default([]),
  /** "Como conheceu" do Avec (normalizado) ou a origem do primeiro lead; null quando não identificada. */
  originLabel: text("origin_label"),
  /** "CLIENTE GILVAN" no "Como conheceu" do Avec: a Casa usava o campo para guardar a profissional. */
  avecProfessionalHint: text("avec_professional_hint"),
  debtCents: bigint("debt_cents", { mode: "number" }).notNull().default(0),
  debtCount: integer("debt_count").notNull().default(0),
  lastDebtOn: date("last_debt_on"),
  creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
  creditCount: integer("credit_count").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("contact_stats_return_idx").on(t.returnDueOn),
  index("contact_stats_last_visit_idx").on(t.lastVisitOn),
  index("contact_stats_pro_idx").on(t.preferredProfessionalId),
  index("contact_stats_origin_idx").on(t.originLabel),
]);
export type ContactStats = typeof contactStats.$inferSelect;
export type Visit = typeof visits.$inferSelect;

/* ───────────────────────── Lote 7A: app da profissional (migration 0028) ───────────────────────── */

/** Avisos do app da profissional: criados na mesma transação da mudança da agenda; o job `push-agenda` do worker envia. */
export const proNotifications = pgTable("pro_notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  /** novo | remarcado | cancelado | chegou | confirmou | folga_aprovada | folga_recusada */
  kind: text("kind").notNull(),
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  /** Silêncio fora do expediente dela: o envio espera até aqui ("chegou" não espera). */
  holdUntil: timestamp("hold_until", { withTimezone: true }),
  createdAt: createdAt(),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [uniqueIndex("pro_notifications_dedupe_uq").on(t.dedupeKey), index("pro_notifications_pending_idx").on(t.pushedAt, t.holdUntil)]);

/** "Vi minha agenda de amanhã": quando a profissional viu a agenda daquele dia. */
export const proDayAcks = pgTable("pro_day_acks", {
  professionalId: uuid("professional_id").notNull().references(() => professionals.id),
  day: date("day").notNull(),
  ackedAt: timestamp("acked_at", { withTimezone: true }).notNull().defaultNow(),
  ackedBy: uuid("acked_by").notNull().references(() => users.id),
}, (t) => [primaryKey({ columns: [t.professionalId, t.day] })]);

/**
 * Anotações da ficha técnica: escritas pela profissional no app ou pela recepção em "Anotar para a profissional".
 * Não são as anotações gerais do contato (`contacts.notes`), que podem trazer assunto de conversa.
 */
export const clientNotes = pgTable("client_notes", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  professionalId: uuid("professional_id").references(() => professionals.id),
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  body: text("body").notNull(),
  /** Foto opcional (relativo a MEDIA_DIR, em notas/) e o tipo conferido pelos bytes. */
  mediaPath: text("media_path"),
  mediaMime: text("media_mime"),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by").references(() => users.id),
}, (t) => [index("client_notes_contact_idx").on(t.contactId, t.createdAt), check("client_notes_body_len", sql`length(${t.body}) <= 2000`)]);

export type ProNotification = typeof proNotifications.$inferSelect;
export type ClientNote = typeof clientNotes.$inferSelect;

/* ───────────────────────── Lote 7B: área da cliente (migration 0029) ───────────────────────── */

/** Link da cliente: um por geração; vários da mesma visita podem valer ao mesmo tempo. O token nunca é guardado: só o hash (SHA-256). */
export const clientLinks = pgTable("client_links", {
  id: id(),
  tokenHash: text("token_hash").notNull(),
  visitId: uuid("visit_id").notNull().references(() => visits.id),
  /** Início da visita quando o link foi gerado ("Seu horário mudou" quando o início atual é outro). */
  issuedStartsAt: timestamp("issued_starts_at", { withTimezone: true }).notNull(),
  /** null = lembrete automático. */
  createdBy: uuid("created_by").references(() => users.id),
  /** conversa | agenda | lembrete_d1 */
  createdVia: text("created_via").notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  openCount: integer("open_count").notNull().default(0),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  /** confirmou | pediu_remarcar | cancelou */
  lastAction: text("last_action"),
  lastActionAt: timestamp("last_action_at", { withTimezone: true }),
}, (t) => [uniqueIndex("client_links_token_uq").on(t.tokenHash), index("client_links_visit_idx").on(t.visitId)]);

export type ClientLink = typeof clientLinks.$inferSelect;

/* ───────────────────────── Nova Agenda: preferências por usuário (migration 0041) ───────────────────────── */

/**
 * Escolhas de tela de cada pessoa (chave "agenda": visões salvas do Personalizar). Validadas no domínio (`user-prefs.ts`) antes de
 * gravar; nunca guardam dado de cliente.
 */
export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] }), check("user_preferences_value_size", sql`pg_column_size(${t.value}) <= 65536`)]);

/**
 * Sugestão de resposta por IA (16/10): a IA só SUGERE; quem envia é a atendente (toca "Usar", confere e aperta Enviar).
 * Gerada SOB DEMANDA (economia): ao abrir a conversa com a última mensagem da cliente sem sugestão, e no "Outra".
 * Uma linha por chamada à API: o custo fica aqui e soma no teto do mês/dia. Sem texto e sem `dismissedAt` = sendo escrita.
 * `lastMessageId` = a mensagem da cliente que a sugestão responde; mensagem nova (ou resposta da Casa) e a sugestão some da tela.
 */
export const aiSuggestions = pgTable("ai_suggestions", {
  id: id(),
  /** Vazio só em "programada" (texto de mensagem programada, 0046): não é sugestão de nenhuma mensagem, só conta no gasto. */
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  lastMessageId: uuid("last_message_id").references(() => messages.id, { onDelete: "cascade" }),
  resumo: text("resumo").notNull(),
  sugestao: text("sugestao").notNull(),
  precisaHumano: boolean("precisa_humano").notNull().default(false),
  motivo: text("motivo"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  /** Tokens lidos do cache (o bloco fixo de serviços/preços/horário). */
  cachedTokens: integer("cached_tokens").notNull().default(0),
  /** Tokens gravados no cache (a 1ª chamada depois de 5 min parada). */
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** Custo em milionésimos de dólar (US$ 1 = 1.000.000), calculado com os preços do modelo (src/server/ai/pricing.ts). */
  costUsdMicros: integer("cost_usd_micros").notNull().default(0),
  /** "auto": a 1ª sugestão da mensagem (gerada ao abrir a conversa, uma vez só); "outra": a atendente pediu outra;
   *  "programada": "Escrever com IA" no Retomar/Programar mensagem (sem conversa nem mensagem ligadas). */
  origin: text("origin").$type<"auto" | "outra" | "programada">().notNull().default("auto"),
  /** O pedido (0047): "" = sugestão comum; senão a mensagem citada e o tema da atendente ("<id da citada>|<tema>"). Entra na chave da 1ª sugestão. */
  pedido: text("pedido").notNull().default(""),
  /** O horário que a sugestão propôs (0050), já conferido no servidor: dia, hora, profissional, serviço e duração. Vazio = sem proposta. */
  horario: jsonb("horario").$type<import("../../lib/proposed-slot").ProposedSlot>(),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
}, (t) => [
  index("ai_suggestions_deal_idx").on(t.dealId, t.createdAt), index("ai_suggestions_created_idx").on(t.createdAt),
  // Economia: a 1ª sugestão de cada pedido (última mensagem + tema + citada) sai UMA vez só (duas pessoas juntas não pagam duas).
  uniqueIndex("ai_suggestions_auto_uq").on(t.lastMessageId, t.pedido).where(sql`${t.origin} = 'auto'`),
]);

/* ───────────────────────── Fichas da cliente (0082, Fase C itens 21 e 25b) ───────────────────────── */

/**
 * As perguntas das três fichas: Anamnese e Campos da ficha (uma resposta por cliente) e Consultoria de imagem (uma por visita).
 * Não se apaga pergunta: desativa, e a resposta antiga continua na ficha. `avecSlug` é a chave da pergunta no Avec (importação, T5).
 */
export const formQuestions = pgTable("form_questions", {
  id: id(),
  /** anamnese | consultoria | campos (src/lib/fichas.ts). */
  form: text("form").notNull(),
  position: integer("position").notNull().default(0),
  label: text("label").notNull(),
  /** opcao | caixas | texto | texto_longo | sim_nao | data. */
  kind: text("kind").notNull(),
  options: text("options").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  avecSlug: text("avec_slug"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("form_questions_form_position_idx").on(t.form, t.position),
  check("form_questions_form_check", sql`${t.form} IN ('anamnese','consultoria','campos')`),
  check("form_questions_kind_check", sql`${t.kind} IN ('opcao','caixas','texto','texto_longo','sim_nao','data')`),
]);

/**
 * A resposta de uma cliente a uma pergunta (`value`: texto, ou lista de opções nas caixas). Uma por (cliente, pergunta, visita), com a
 * visita vazia contando como um valor só. Dado da cliente: fora de exportação, da IA e do Avec. `externalKey` só vem da importação do Avec.
 */
export const formAnswers = pgTable("form_answers", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => formQuestions.id),
  visitId: uuid("visit_id").references(() => visits.id),
  value: jsonb("value").$type<string | string[]>().notNull(),
  /** crm | avec. */
  source: text("source").notNull().default("crm"),
  answeredBy: uuid("answered_by").references(() => users.id),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  externalKey: text("external_key"),
}, (t) => [
  unique("form_answers_contact_question_visit_uq").on(t.contactId, t.questionId, t.visitId).nullsNotDistinct(),
  index("form_answers_contact_idx").on(t.contactId),
  uniqueIndex("form_answers_external_key_uq").on(t.externalKey).where(sql`${t.externalKey} is not null`),
  check("form_answers_source_check", sql`${t.source} IN ('crm','avec')`),
]);

/** Fotos de antes e depois (usadas pela T4). Sempre reais, da câmera ou de um arquivo, sem edição. Apagar é marcar `deletedAt`. */
export const clientPhotos = pgTable("client_photos", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  visitId: uuid("visit_id").references(() => visits.id),
  /** antes | depois. */
  kind: text("kind").notNull(),
  mediaPath: text("media_path").notNull(),
  mediaMime: text("media_mime").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by").references(() => users.id),
}, (t) => [
  index("client_photos_contact_idx").on(t.contactId, t.createdAt),
  check("client_photos_kind_check", sql`${t.kind} IN ('antes','depois')`),
]);

/**
 * Programas de fidelidade da Casa (0083, item 22): "Fiel da Fiaes", "10x Você" e "Aniversário". `contagem`: cada serviço que conta vale
 * 1 ponto por unidade ao fechar a comanda, e `goal` pontos viram o prêmio (`reward_service_ids` com `reward_discount_bp` de desconto).
 * `aniversario`: no mês do aniversário da cliente, uma vez por ano, o desconto vai num serviço do prêmio. `counts_service_ids` null = todos
 * os serviços; `max_discount_bp` null = qualquer desconto pontua; `reward_reason_template` é o motivo do desconto ({programa} = o nome).
 */
export const loyaltyPrograms = pgTable("loyalty_programs", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** contagem | aniversario. */
  kind: text("kind").notNull().$type<"contagem" | "aniversario">(),
  goal: smallint("goal"),
  countsServiceIds: uuid("counts_service_ids").array(),
  rewardServiceIds: uuid("reward_service_ids").array().notNull().default(sql`'{}'::uuid[]`),
  rewardDiscountBp: integer("reward_discount_bp").notNull().default(10000),
  maxDiscountBp: integer("max_discount_bp"),
  /** Decisão do dono (R8): o item que consome sessão de pacote só pontua se o programa ligar isto. */
  countsPackageSessions: boolean("counts_package_sessions").notNull().default(false),
  rewardReasonTemplate: text("reward_reason_template").notNull().default("Fidelidade: {programa}"),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  check("loyalty_programs_kind_check", sql`${t.kind} IN ('contagem','aniversario')`),
  check("loyalty_programs_goal_check", sql`${t.kind} <> 'contagem' OR ${t.goal} > 0`),
  check("loyalty_programs_bp_check", sql`${t.rewardDiscountBp} BETWEEN 1 AND 10000 AND (${t.maxDiscountBp} IS NULL OR ${t.maxDiscountBp} BETWEEN 0 AND 10000)`),
]);

/**
 * Extrato de pontos (0083): o saldo é a soma de `delta` por cliente e programa. `servico` (+qtd, ao fechar a comanda), `resgate` (−meta na
 * contagem; −1 no aniversário, que marca o ano), `saldo_avec` (importação, `external_key`) e `ajuste`. Uma linha por item, programa e motivo.
 */
export const loyaltyEntries = pgTable("loyalty_entries", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  programId: uuid("program_id").notNull().references(() => loyaltyPrograms.id),
  delta: integer("delta").notNull(),
  /** servico | resgate | saldo_avec | ajuste. */
  reason: text("reason").notNull().$type<"servico" | "resgate" | "saldo_avec" | "ajuste">(),
  comandaId: uuid("comanda_id").references(() => comandas.id),
  comandaItemId: uuid("comanda_item_id").references(() => comandaItems.id),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  externalKey: text("external_key"),
}, (t) => [
  index("loyalty_entries_contact_program_idx").on(t.contactId, t.programId),
  index("loyalty_entries_comanda_idx").on(t.comandaId),
  uniqueIndex("loyalty_entries_item_uq").on(t.programId, t.comandaItemId, t.reason).where(sql`${t.comandaItemId} is not null`),
  uniqueIndex("loyalty_entries_external_key_uq").on(t.externalKey).where(sql`${t.externalKey} is not null`),
  check("loyalty_entries_delta_check", sql`${t.delta} <> 0`),
  check("loyalty_entries_reason_check", sql`${t.reason} IN ('servico','resgate','saldo_avec','ajuste')`),
]);

/* ───────────────────────── Unir cadastros (0086, Fase C item 25a) ───────────────────────── */

/**
 * Cada junção de dois cadastros da mesma cliente: quem ficou (`keptId`) e quem saiu (id, telefone, @lid e nome, para que mensagem nova e
 * importação do Avec com os dados dela caiam na que ficou: `mergedTargetFor`). `snapshot` guarda o que não coube na que ficou (a ficha da
 * outra, o `importedFields.avec` dela, respostas que perderam). Unir A (sai) em B: as junções com `keptId` = A passam a B (a cadeia continua).
 */
export const contactMerges = pgTable("contact_merges", {
  id: id(),
  keptId: uuid("kept_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  droppedId: uuid("dropped_id").notNull(),
  droppedPhone: text("dropped_phone").notNull(),
  droppedWaLid: text("dropped_wa_lid"),
  droppedName: text("dropped_name"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  mergedBy: uuid("merged_by").references(() => users.id),
  mergedAt: timestamp("merged_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("contact_merges_dropped_phone_idx").on(t.droppedPhone),
  index("contact_merges_dropped_wa_lid_idx").on(t.droppedWaLid).where(sql`${t.droppedWaLid} is not null`),
  index("contact_merges_kept_idx").on(t.keptId),
]);
export type ContactMerge = typeof contactMerges.$inferSelect;

/** Categorias de despesa (Contas a pagar, Fase D). `dreGroup` diz em qual linha do Resultado a categoria entra. */
export const financeCategories = pgTable("finance_categories", {
  id: id(),
  name: text("name").notNull(),
  /** Um de DRE_EXPENSE_GROUPS (src/lib/dre.ts). */
  dreGroup: text("dre_group").notNull(),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("finance_categories_name_uq").on(sql`lower(${t.name})`)]);

/** Contas bancárias da Casa (onde as despesas saem e onde cada forma de pagamento cai). */
export const bankAccounts = pgTable("bank_accounts", {
  id: id(),
  name: text("name").notNull(),
  bank: text("bank"),
  openingCents: integer("opening_cents").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("bank_accounts_name_uq").on(sql`lower(${t.name})`)]);

/** Despesas da Casa. Repetidas por vários meses viram uma série (`seriesId`), uma linha por parcela. */
export const expenses = pgTable("expenses", {
  id: id(),
  title: text("title").notNull(),
  categoryId: uuid("category_id").notNull().references(() => financeCategories.id),
  supplier: text("supplier"),
  amountCents: integer("amount_cents").notNull(),
  dueOn: date("due_on").notNull(),
  /** 1º dia do mês a que a despesa pertence no Resultado. */
  competence: date("competence").notNull(),
  paidOn: date("paid_on"),
  paidCents: integer("paid_cents"),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  paidMethod: text("paid_method"),
  seriesId: uuid("series_id"),
  installment: smallint("installment").notNull().default(1),
  installments: smallint("installments").notNull().default(1),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
}, (t) => [
  check("expenses_amount_pos", sql`${t.amountCents} > 0`),
  index("expenses_due_idx").on(t.dueOn).where(sql`${t.cancelledAt} is null`),
  index("expenses_paid_idx").on(t.paidOn),
  index("expenses_series_idx").on(t.seriesId),
]);

export type FinanceCategory = typeof financeCategories.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type Expense = typeof expenses.$inferSelect;

/** Catálogo de produtos (0091). O estoque não é coluna: é a soma dos movimentos vivos. */
export const products = pgTable("products", {
  id: id(),
  name: text("name").notNull(),
  brand: text("brand"),
  category: text("category"),
  barcode: text("barcode"),
  ncm: text("ncm"),
  cfop: text("cfop").notNull().default("5102"),
  csosn: text("csosn").notNull().default("102"),
  unit: text("unit").notNull().default("UN"),
  priceCents: integer("price_cents"),
  costCents: integer("cost_cents"),
  /** venda | consumo */ use: text("use").notNull().default("venda"),
  minQty: numeric("min_qty", { mode: "number" }),
  avecName: text("avec_name"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("products_name_uq").on(sql`lower(${t.name})`),
  check("products_ncm_ck", sql`${t.ncm} is null or ${t.ncm} ~ '^[0-9]{8}$'`),
  check("products_use_ck", sql`${t.use} in ('venda', 'consumo')`),
]);

/** Movimentos de estoque (0091): venda | entrada | saida | ajuste | saldo_avec. Estorno marca `cancelledAt`. */
export const stockMovements = pgTable("stock_movements", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id),
  deltaQty: numeric("delta_qty", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  comandaItemId: uuid("comanda_item_id").references(() => comandaItems.id),
  unitCostCents: integer("unit_cost_cents"),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (t) => [
  check("stock_movements_delta_ck", sql`${t.deltaQty} <> 0`),
  check("stock_movements_reason_ck", sql`${t.reason} in ('venda', 'entrada', 'saida', 'ajuste', 'saldo_avec')`),
  index("stock_movements_product_idx").on(t.productId),
  uniqueIndex("stock_movements_sale_uq").on(t.comandaItemId).where(sql`${t.reason} = 'venda'`),
]);

export type Product = typeof products.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;

/** Notas fiscais emitidas (0092): NFS-e (nfse.gov.br) e NFC-e (SEFAZ-BA). Uma viva (pendente ou autorizada) por comanda e tipo. */
export const fiscalDocuments = pgTable("fiscal_documents", {
  id: id(),
  comandaId: uuid("comanda_id").notNull().references(() => comandas.id),
  /** nfse | nfce */ kind: text("kind").notNull(),
  /** teste | producao */ environment: text("environment").notNull(),
  series: integer("series").notNull(),
  number: bigint("number", { mode: "number" }).notNull(),
  /** O Id da DPS ou da NFC-e. */ localId: text("local_id").notNull(),
  accessKey: text("access_key"),
  /** pendente | autorizada | rejeitada | erro_envio | cancelada */ status: text("status").notNull().default("pendente"),
  amountCents: integer("amount_cents").notNull(),
  requestXml: text("request_xml"),
  responseBody: text("response_body"),
  rejectReason: text("reject_reason"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextTryAt: timestamp("next_try_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
}, (t) => [
  check("fiscal_documents_kind_ck", sql`${t.kind} in ('nfse', 'nfce')`),
  check("fiscal_documents_env_ck", sql`${t.environment} in ('teste', 'producao')`),
  check("fiscal_documents_status_ck", sql`${t.status} in ('pendente', 'autorizada', 'rejeitada', 'erro_envio', 'cancelada')`),
  // 0094 (I-3): única por comanda, tipo e ambiente (a de Teste não impede a de Produção).
  uniqueIndex("fiscal_documents_live_uq").on(t.comandaId, t.kind, t.environment).where(sql`${t.status} in ('pendente', 'autorizada')`),
  uniqueIndex("fiscal_documents_number_uq").on(t.kind, t.environment, t.series, t.number),
  index("fiscal_documents_comanda_idx").on(t.comandaId),
]);

/** Próximo número de cada série (0092), por tipo e ambiente. */
export const fiscalSequences = pgTable("fiscal_sequences", {
  kind: text("kind").notNull(),
  environment: text("environment").notNull(),
  series: integer("series").notNull(),
  nextNumber: bigint("next_number", { mode: "number" }).notNull().default(1),
}, (t) => [primaryKey({ columns: [t.kind, t.environment, t.series] })]);

export type FiscalDocument = typeof fiscalDocuments.$inferSelect;
