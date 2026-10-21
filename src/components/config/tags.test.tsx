// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { rename, color, merge } = vi.hoisted(() => ({
  rename: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  color: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  merge: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { moved: 3 } })),
}));
vi.mock("@/app/(app)/config/actions", () => ({
  renameTagAction: (...a: unknown[]) => rename(...a), setTagColorAction: (...a: unknown[]) => color(...a), mergeTagsAction: (...a: unknown[]) => merge(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { TagsAdmin } from "./tags";

afterEach(cleanup);

it("mostra a contagem, troca a cor, renomeia e junta; 'Uso de imagem' não muda de nome nem tem Juntar", async () => {
  render(<TagsAdmin tags={[
    { id: "t1", name: "VIP", color: null, uses: 12, protected: false },
    { id: "t2", name: "vip cliente", color: "#2f6b4f", uses: 3, protected: false },
    { id: "t3", name: "Uso de imagem", color: null, uses: 38, protected: true },
  ]} />);
  expect(screen.getByText("12 clientes")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Cor 2 de VIP" }));
  await waitFor(() => expect(color).toHaveBeenCalledWith("t1", "#2f6b4f"));
  const nome = screen.getByLabelText("Nome da etiqueta VIP");
  fireEvent.change(nome, { target: { value: "VIPs" } });
  fireEvent.blur(nome);
  await waitFor(() => expect(rename).toHaveBeenCalledWith("t1", "VIPs"));
  fireEvent.click(screen.getByRole("button", { name: "Juntar vip cliente com outra" }));
  fireEvent.change(screen.getByLabelText("Juntar em"), { target: { value: "t1" } });
  fireEvent.click(screen.getByRole("button", { name: "Juntar" }));
  await waitFor(() => expect(merge).toHaveBeenCalledWith("t2", "t1"));
  expect(screen.queryByLabelText("Nome da etiqueta Uso de imagem")).toBeNull();
  expect(screen.queryByRole("button", { name: "Juntar Uso de imagem com outra" })).toBeNull();
});
