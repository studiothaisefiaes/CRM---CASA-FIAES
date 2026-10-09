import "dotenv/config";
import { db, pool } from "../src/server/db";
import { seed } from "../src/server/db/seed";

seed(db).then((r) => { console.log("Seed ok:", r); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
