// src/components/config/team.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { setSig } = vi.hoisted(() => ({ setSig: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { signature: "SARA" } })) }));
vi.mock("@/app/(app)/config/actions", () => ({
  createMemberAction: vi.fn(), resetMemberPasswordAction: vi.fn(), setMemberActiveAction: vi.fn(), setMemberProfileAction: vi.fn(),
  setMemberSignatureAction: (...a: unknown[]) => setSig(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { TeamEditor } from "./team";

afterEach(cleanup);

it("assinatura: mostra como a cliente vê e salva em maiúsculas", async () => {
  render(<TeamEditor me="g" profiles={[{ id: "p", name: "Atendente", key: "atendente" }]}
    members={[{ id: "u1", name: "Sara Lima", email: "s@c.com", profileId: "p", active: true, pending: false, signature: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Assinatura de Sara Lima: sem assinatura" }));
  fireEvent.change(screen.getByLabelText("Assinatura"), { target: { value: "sara" } });
  expect(screen.getByText("*SARA - CASA FIAES:*")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Salvar assinatura" }));
  await waitFor(() => expect(setSig).toHaveBeenCalledWith("u1", "SARA"));
});

it("sem assinatura cadastrada: avisa e mostra a padrão (1º nome) que vai nas mensagens", () => {
  render(<TeamEditor me="g" profiles={[{ id: "p", name: "Atendente", key: "atendente" }]}
    members={[{ id: "u1", name: "Sara Lima", email: "s@c.com", profileId: "p", active: true, pending: false, signature: null }]} />);
  expect(screen.getByRole("button", { name: "Assinatura de Sara Lima: sem assinatura" }).textContent).toBe("SARA (padrão)");
  expect(screen.getByRole("note").textContent).toContain("1 pessoa sem assinatura cadastrada");
});

it("quem não atende conversas (o Contador) não conta no aviso de assinatura e não tem assinatura para escolher", () => {
  render(<TeamEditor me="g" profiles={[{ id: "p", name: "Atendente", key: "atendente" }, { id: "c", name: "Contador", key: "contador" }]}
    members={[{ id: "u2", name: "Carlos Contador", email: "c@contabil.com", profileId: "c", active: true, pending: false, signature: null, atende: false }]} />);
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.queryByRole("button", { name: /Assinatura de Carlos Contador/ })).toBeNull();
  expect(screen.getByText("Não conversa com clientes")).toBeTruthy();
});
