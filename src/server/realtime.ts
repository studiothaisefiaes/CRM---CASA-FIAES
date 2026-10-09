import { Client } from "pg";

type Listener = (payload: string) => void;
type State = { listeners: Set<Listener>; client: Client | null; connecting: boolean };

// Um único LISTEN por processo; as abas abertas recebem os avisos em memória.
const g = globalThis as unknown as { __crmRealtime?: State };
const state: State = (g.__crmRealtime ??= { listeners: new Set(), client: null, connecting: false });

async function connect() {
  if (state.client || state.connecting) return;
  state.connecting = true;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    client.on("notification", (m) => { if (m.channel === "crm_events") state.listeners.forEach((l) => l(m.payload ?? "{}")); });
    const retry = () => { if (state.client === client) state.client = null; client.end().catch(() => {}); setTimeout(() => { if (state.listeners.size) void connect(); }, 2_000); };
    client.on("error", retry);
    client.on("end", () => { if (state.client === client) { state.client = null; if (state.listeners.size) setTimeout(() => void connect(), 2_000); } });
    await client.query("LISTEN crm_events");
    state.client = client;
  } catch (e) {
    console.error("[tempo real] falha ao conectar", e);
    client.end().catch(() => {});
    setTimeout(() => { if (state.listeners.size) void connect(); }, 3_000);
  } finally {
    state.connecting = false;
  }
}

export function subscribe(fn: Listener) {
  state.listeners.add(fn);
  void connect();
  return () => { state.listeners.delete(fn); };
}
