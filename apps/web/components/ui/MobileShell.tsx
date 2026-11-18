import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";

/** Centers content on desktop; caps width at mobile phone (~480px). */
export function MobileShell({
  children,
  className = "",
  showFooter = true,
}: {
  children: ReactNode;
  className?: string;
  /** Global statutory footer with policy links (default on). */
  showFooter?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <div
        className={`mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 pb-8 pt-safe ${className}`}
      >
        {children}
      </div>
      {showFooter ? <Footer /> : null}
    </div>
  );
}
