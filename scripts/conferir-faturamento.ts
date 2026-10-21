// scripts/conferir-faturamento.ts
import "dotenv/config";
import { pool } from "../src/server/db";
import { yearlyCheck } from "../src/server/reports/salon";

// Lote 3: confere o faturamento do Salão contra os pagamentos, por ano. SÓ LEITURA (nada é gravado).
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/conferir-faturamento.ts
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const rows = await yearlyCheck();
  console.log("Ano  | Faturamento (sem sessões de pacote) | Com as sessões     | Pagamentos         | Diferença");
  for (const r of rows) {
    console.log(`${r.ano} | ${brl(r.faturamentoCents).padStart(35)} | ${brl(r.comPacoteCents).padStart(18)} | ${brl(r.pagamentosCents).padStart(18)} | ${r.diferencaPct == null ? "—" : `${r.diferencaPct}%`}`);
  }
  const fora = rows.filter((r) => r.diferencaPct != null && Math.abs(r.diferencaPct) >= 5);
  console.log(fora.length ? `\nAtenção: diferença de 5% ou mais em ${fora.map((r) => r.ano).join(", ")}. Mostrar ao dono antes de seguir.` : "\nTodos os anos com diferença menor que 5%.");
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
