import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db, pool } from "../src/server/db";
import { profiles, users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { findUserByEmail } from "../src/server/auth/users";
import { eq } from "drizzle-orm";

// Uso: npm run seed:admin -- --email gestao@casafiaes.com.br --name "Gestão" [--password ...]
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
async function main() {
  const email = arg("email"); const name = arg("name") ?? "Gestão";
  if (!email) throw new Error("Informe --email");
  const password = arg("password") ?? randomBytes(9).toString("base64url");
  const existing = await findUserByEmail(email);
  const passwordHash = await hashPassword(password);
  const [gestao] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "gestao"));
  if (!gestao) throw new Error("Perfil Gestão não existe: rode npm run db:migrate e npm run db:seed antes");
  if (existing) await db.update(users).set({ passwordHash, role: "gestor", profileId: gestao.id, active: true }).where(eq(users.id, existing.id));
  else await db.insert(users).values({ name, email, passwordHash, role: "gestor", profileId: gestao.id });
  console.log(`Gestor pronto: ${email}\nSenha: ${password}\n(troque depois em Configurações > Equipe)`);
}
main().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
