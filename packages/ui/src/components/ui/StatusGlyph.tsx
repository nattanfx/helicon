import { CircleAlert, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import type { ThreadStatus } from "../../model/status.js";
import { Spinner, cn } from "./primitives.js";

/** A marca de status de relance para uma conversa. Sempre acompanhada de texto em outro lugar; nunca só cor. */
export function StatusGlyph(props: { status: ThreadStatus; className?: string }) {
  switch (props.status) {
    case "running":
      return <Spinner size={12} className={cn("text-accent-text", props.className)} />;
    case "approval":
      return <ShieldAlert size={14} strokeWidth={2} className={cn("attention-pulse text-warn", props.className)} aria-hidden="true" />;
    case "input":
      return (
        <MessageCircleQuestion size={14} strokeWidth={2} className={cn("attention-pulse text-warn", props.className)} aria-hidden="true" />
      );
    case "failed":
      return <CircleAlert size={14} strokeWidth={2} className={cn("text-danger", props.className)} aria-hidden="true" />;
    case "unread":
      return <span className={cn("block size-[7px] rounded-full bg-accent", props.className)} aria-hidden="true" />;
    default:
      return null;
  }
}
