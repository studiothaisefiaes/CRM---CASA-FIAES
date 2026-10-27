// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SYSTEM_PROFILES, type Perm } from "@/lib/permissions";

vi.mock("@/app/(app)/config/actions", () => ({ deleteProfileAction: vi.fn(), duplicateProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ProfilesEditor } from "./profiles-editor";

afterEach(cleanup);

it("o perfil Contador traz a explicação no editor, como a Gestão", () => {
  const c = SYSTEM_PROFILES.find((p) => p.key === "contador")!;
  render(<ProfilesEditor profiles={[{ id: "c", key: "contador", name: "Contador", permissions: [...c.permissions] as Perm[], isSystem: true, members: 0 }]} />);
  expect(screen.getByRole("note").textContent).toMatch(/só vê o dinheiro e o fiscal, sem mudar nada/);
  expect(screen.getByRole("note").textContent).toMatch(/Gerar link para o contador/);
});
