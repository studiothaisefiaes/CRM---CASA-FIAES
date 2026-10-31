// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const nomear = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const arquivar = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/config/actions", () => ({ nameAdCampaignAction: (...a: unknown[]) => nomear(...a), setAdCampaignArchivedAction: (...a: unknown[]) => arquivar(...a) }));
import { AdCampaigns, type AdRow } from "./ad-campaigns";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ROWS: AdRow[] = [
  { adId: "111", name: null, label: "“Hoje quis mostrar um cabelo sem finalização. Porque…”", sourceApp: "instagram", postUrl: "https://www.instagram.com/p/TESTE123/", title: "CASA FIAES",
    body: "Hoje quis mostrar um cabelo sem finalização. Porque o Método FIAES foi criado pra ser assim…", firstSeenAt: "2026-10-14T13:00:00Z", lastSeenAt: "2026-10-26T13:00:00Z", archived: false, conversas: 12 },
  { adId: "222", name: "Campanha velha", label: "Campanha velha", sourceApp: "facebook", postUrl: null, title: null, body: null, firstSeenAt: "2026-09-01T13:00:00Z", lastSeenAt: "2026-09-02T13:00:00Z", archived: true, conversas: 1 },
];

it("lista o anúncio com texto, post, primeira/última vez e conversas; dar nome salva ao sair do campo; arquivar", async () => {
  render(<ToastProvider><AdCampaigns rows={ROWS} /></ToastProvider>);
  const card = screen.getByRole("article", { name: /Hoje quis mostrar/ });
  expect(card.textContent).toContain("Instagram");
  expect(card.textContent).toContain("12 conversas");
  expect(card.textContent).toContain("Primeira vez 14/10 · última 26/10");
  expect(within(card).getByRole("link", { name: "Ver post" }).getAttribute("href")).toBe("https://www.instagram.com/p/TESTE123/");
  const input = within(card).getByLabelText("Nome da campanha") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Método Fiaes® outubro" } });
  await act(async () => { fireEvent.blur(input); });
  expect(nomear).toHaveBeenCalledWith("111", "Método Fiaes® outubro");
  await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Arquivar" })); });
  expect(arquivar).toHaveBeenCalledWith("111", true);
  // Arquivados ficam embaixo, fechados, com Desarquivar.
  expect(screen.getByText("Arquivados (1)")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Desarquivar" })).toBeTruthy();
});

it("sem anúncios: explica que aparecem sozinhos", () => {
  render(<ToastProvider><AdCampaigns rows={[]} /></ToastProvider>);
  expect(screen.getByText(/Nenhum anúncio ainda/)).toBeTruthy();
});
