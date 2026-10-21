import { ClientLink } from "@/components/contacts/client-link";
import { cn } from "@/lib/cn";

/** O nome da cliente no cabeçalho da conversa (h2, com link para a ficha) e no painel (h3): quebra a linha em vez de cortar com reticências. */
export function NameHeading({ as: Tag, name, contactId, className }: { as: "h2" | "h3"; name: string; contactId?: string; className?: string }) {
  return (
    <Tag className={cn("min-w-0 break-words [overflow-wrap:anywhere]", className)}>
      {contactId ? <ClientLink contactId={contactId} name={name} className="pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center">{name}</ClientLink> : name}
    </Tag>
  );
}
