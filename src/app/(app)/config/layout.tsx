import { requireGestor } from "@/server/auth/session";
import { ConfigNav } from "@/components/config/config-nav";

export default async function ConfigLayout({ children }: LayoutProps<"/config">) {
  await requireGestor();
  return (
    <main className="pb-14">
      <header className="px-5 lg:px-8 pt-6 lg:pt-9 pb-4">
        <h1 className="font-serif text-[32px] lg:text-[38px] leading-none font-light">Configurações</h1>
        <p className="text-graphite mt-2">Tudo aqui pode ser ajustado pela gestão, sem programador.</p>
      </header>
      <ConfigNav />
      <div className="px-5 lg:px-8 mt-5 max-w-[1100px]">{children}</div>
    </main>
  );
}
