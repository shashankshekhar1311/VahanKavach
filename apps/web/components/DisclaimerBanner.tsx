import { AlertTriangle } from "lucide-react";
import { DISCLAIMER_TEXT } from "@/lib/legal";

type DisclaimerVariant = "compact" | "footer";

interface DisclaimerBannerProps {
  variant?: DisclaimerVariant;
  className?: string;
}

/**
 * High-contrast statutory disclaimer for garage input and global footer.
 */
export function DisclaimerBanner({
  variant = "compact",
  className = "",
}: DisclaimerBannerProps) {
  if (variant === "footer") {
    return (
      <aside
        role="note"
        aria-label="Government and affiliation disclaimer"
        className={`rounded-lg border border-amber-warn/40 bg-amber-warn/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100/95 ${className}`}
      >
        <p className="flex gap-2">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-warn"
            aria-hidden
          />
          <span>{DISCLAIMER_TEXT}</span>
        </p>
      </aside>
    );
  }

  return (
    <aside
      role="note"
      aria-label="Government and affiliation disclaimer"
      className={`mt-2 rounded-lg border border-amber-warn/50 bg-zinc-950 px-2.5 py-2 text-[10px] leading-snug text-amber-100/90 ring-1 ring-amber-warn/20 ${className}`}
    >
      <p className="flex gap-1.5">
        <AlertTriangle
          className="mt-0.5 h-3 w-3 shrink-0 text-amber-warn"
          aria-hidden
        />
        <span>{DISCLAIMER_TEXT}</span>
      </p>
    </aside>
  );
}
