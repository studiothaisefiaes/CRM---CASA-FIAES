import "dotenv/config";
// Testes usam o banco crm_test, nunca o de desenvolvimento.
process.env.DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_test$1");
// Arquivos de mídia gravados pelos testes vão para uma pasta temporária, nunca para data/media.
import os from "node:os";
import path from "node:path";
process.env.MEDIA_DIR = path.join(os.tmpdir(), "crm-test-media");
// A Evolution do .env é a de verdade (WhatsApp conectado): teste nunca fala com ela. Endereço morto; quem precisa usa o fake.
process.env.EVOLUTION_URL = "http://127.0.0.1:9";
