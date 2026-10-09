import { it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/whatsapp/webhook", async (orig) => ({
  ...(await orig<typeof import("@/server/whatsapp/webhook")>()),
  ingestEvolution: vi.fn(async () => ({ ok: true })),
}));

import { NextRequest } from "next/server";
import { env } from "@/server/env";
import { resetLimit } from "@/server/auth/rate-limit";
import { POST, WEBHOOK_MAX_PER_MIN } from "./route";

const call = (instance: string, secret = env().WEBHOOK_SECRET) =>
  POST(new NextRequest("http://x/api/webhooks/evolution", {
    method: "POST",
    headers: { "x-webhook-secret": secret, "content-type": "application/json" },
    body: JSON.stringify({ event: "messages.upsert", instance }),
  }));

beforeEach(() => { resetLimit("webhook:rec"); resetLimit("webhook:outra"); });

it("acima de 600 req/min por instância responde 429, outra instância segue livre", async () => {
  for (let i = 0; i < WEBHOOK_MAX_PER_MIN; i++) expect((await call("rec")).status).toBe(200);
  expect((await call("rec")).status).toBe(429);
  expect((await call("outra")).status).toBe(200);
});

it("segredo errado continua 401 e não gasta o limite", async () => {
  expect((await call("rec", "x".repeat(30))).status).toBe(401);
});
