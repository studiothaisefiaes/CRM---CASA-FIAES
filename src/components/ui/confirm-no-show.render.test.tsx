// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const { setAttendanceAction, undoMissedAttendanceAction } = vi.hoisted(() => ({
  setAttendanceAction: vi.fn(async () => ({ ok: true, data: { changed: true, remarcar: true } })),
  undoMissedAttendanceAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/(app)/funil/actions", () => ({ setAttendanceAction, undoMissedAttendanceAction }));
vi.mock("@/components/queue/open-lead", () => ({ useOpenLead: () => () => {} }));
vi.mock("@/components/queue/use-lead-actions", () => ({ attendanceToast: (n: string, s: string) => `${n} ${s}` }));
vi.mock("next/navigation", () => ({ usePathname: () => "/atendimento", useRouter: () => ({ refresh: vi.fn() }) }));
import { ToastProvider } from "./toast";
import { ConfirmNoShowProvider } from "./confirm-no-show";
import { AttendanceStrip } from "@/components/queue/attendance-strip";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = { dealId: "d1", contactId: "c1", name: "Flávia Souza", phone: "+5571999990001", hasAvatar: false, scheduledAt: "2026-10-16T18:00:00.000Z" };
const tela = () => render(<ToastProvider><ConfirmNoShowProvider><AttendanceStrip items={[item as never]} /></ConfirmNoShowProvider></ToastProvider>);

it("Faltou pede confirmação: Voltar não marca nada (QA r58, M-2)", async () => {
  tela();
  fireEvent.click(screen.getByRole("button", { name: "Faltou: Flávia Souza" }));
  const dlg = screen.getByRole("dialog", { name: "O que aconteceu?" });
  expect(dlg.textContent).toContain("Flávia Souza");
  fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
  expect(setAttendanceAction).not.toHaveBeenCalled();
});

it("confirmado, marca a falta e o aviso oferece Desfazer", async () => {
  tela();
  fireEvent.click(screen.getByRole("button", { name: "Faltou: Flávia Souza" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar que não veio" })); });
  expect(setAttendanceAction).toHaveBeenCalledWith("d1", "faltou");
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Desfazer" })); });
  expect(undoMissedAttendanceAction).toHaveBeenCalledWith("d1");
});
