import "dotenv/config";
// Testes usam o banco crm_test, nunca o de desenvolvimento.
process.env.DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(/\/crm(\?|$)/, "/crm_test$1");
