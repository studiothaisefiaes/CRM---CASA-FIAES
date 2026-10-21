import { cn } from "@/lib/cn";

/**
 * Um componente de abas (dsgfix): as abas que NAVEGAM são sempre sublinhadas, com a mesma altura (44 px) e o mesmo texto, seja link
 * (`SectionTabs`) ou botão (`UnderlineTabs`). A pílula (`Tabs`/`Segmented`) fica só para filtrar dentro de uma tela.
 */
export const tabListClass = (className?: string) => cn("-mx-5 flex gap-1 overflow-x-auto border-b border-line px-5 scroll-thin lg:mx-0 lg:px-0", className);
export const tabClass = (on: boolean) =>
  cn("-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-base font-medium transition-colors", on ? "border-ink text-ink" : "border-transparent text-graphite hover:text-ink");
