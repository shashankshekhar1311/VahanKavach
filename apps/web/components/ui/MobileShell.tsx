import type { ReactNode } from "react";

/** Centers content on desktop; caps width at mobile phone (~480px). */
export function MobileShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div
        className={`mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pb-8 pt-safe ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
