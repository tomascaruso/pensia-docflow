import type { DocumentStatus } from "@pensia-docflow/shared";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle,
  Clock,
  Loader2,
  Upload,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { documentStatusLabel } from "../../lib/document-labels";

/**
 * Badge de estado de documento (F4, S2/S3). Patrón F3.5b: fondo suave
 * + texto oscuro + borde sutil + ícono 12px + texto. El color nunca
 * es el único portador del significado: el texto y el ícono también
 * lo dicen.
 */
const STATUS_STYLE: Record<
  DocumentStatus,
  { classes: string; icon: LucideIcon; spin?: boolean }
> = {
  uploaded: {
    classes: "border-slate-200 bg-slate-100 text-slate-700",
    icon: Upload,
  },
  queued: {
    classes: "border-blue-200 bg-blue-50 text-blue-700",
    icon: Clock,
  },
  processing: {
    classes: "border-blue-200 bg-blue-50 text-blue-700",
    icon: Loader2,
    spin: true,
  },
  needs_review: {
    classes: "border-amber-200 bg-amber-50 text-amber-700",
    icon: AlertCircle,
  },
  approved: {
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CheckCircle,
  },
  rejected: {
    classes: "border-rose-200 bg-rose-50 text-rose-700",
    icon: XCircle,
  },
  failed: {
    classes: "border-red-200 bg-red-50 text-red-700",
    icon: AlertTriangle,
  },
  blocked: {
    classes: "border-red-200 bg-red-100 text-red-800",
    icon: Ban,
  },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}
    >
      <Icon
        aria-hidden="true"
        className={`h-3 w-3${style.spin ? " animate-spin" : ""}`}
      />
      {documentStatusLabel(status)}
    </span>
  );
}
