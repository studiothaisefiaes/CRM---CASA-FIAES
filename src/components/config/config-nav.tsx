"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion";

const TABS = [["/config/automacoes", "Automações"], ["/config/etapas", "Etapas e prazos"], ["/config/listas", "Listas e respostas"], ["/config/whatsapp", "WhatsApp"], ["/config/equipe", "Equipe"]] as const;
export function ConfigNav() {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector("[aria-current=page]")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [path]);
  return (
    <nav ref={ref} className="px-5 lg:px-8 border-b border-line overflow-x-auto scroll-thin" aria-label="Configurações">
      <ul className="flex gap-1">
        {TABS.map(([href, label]) => {
          const on = path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? "page" : undefined} className={`relative inline-flex h-10 items-center px-3 text-[13.5px] whitespace-nowrap ${on ? "text-ink font-medium" : "text-graphite hover:text-ink"}`}>
                {label}{on && <motion.span layoutId="cfg-underline" transition={SPRING} className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-gold" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
