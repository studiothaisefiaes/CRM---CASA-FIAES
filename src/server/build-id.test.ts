import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBuildId } from "./build-id";

const ENV = { NODE_ENV: process.env.NODE_ENV, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR };
afterEach(() => { Object.assign(process.env, ENV); if (ENV.NEXT_DIST_DIR === undefined) delete process.env.NEXT_DIST_DIR; });

describe("id da versão do CRM (o BUILD_ID do next build)", () => {
  it("lê o BUILD_ID da pasta do build (NEXT_DIST_DIR ou .next)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "crm-build-"));
    writeFileSync(path.join(dir, "BUILD_ID"), "Abc123_x\n");
    process.env.NEXT_DIST_DIR = dir;
    expect(readBuildId()).toBe("Abc123_x");
  });

  it("sem build (next dev, pasta vazia): 'dev', que nunca conta como versão nova", () => {
    process.env.NEXT_DIST_DIR = mkdtempSync(path.join(os.tmpdir(), "crm-build-"));
    expect(readBuildId()).toBe("dev");
    (process.env as Record<string, string>).NODE_ENV = "development";
    expect(readBuildId()).toBe("dev");
  });
});
