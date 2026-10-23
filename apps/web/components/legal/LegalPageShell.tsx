import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { LEGAL } from "@/lib/legal";

interface LegalPageShellProps {

  title: string;
  description?: string;
  children: ReactNode;
}

export function LegalPageShell({
  title,
  description,
  children,
}: LegalPageShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-atmosphere text-zinc-100">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-tight text-safety"
          >
            {LEGAL.productName}
          </Link>
          <Link
            href="/contact"
            className="text-xs text-zinc-400 transition hover:text-zinc-200"
          >
            Contact
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          Legal
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            {description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-zinc-600">
          Last updated: {LEGAL.lastUpdated}
        </p>

        <article className="prose-legal mt-8 space-y-8 text-sm leading-relaxed text-zinc-300">
          {children}
        </article>
      </main>

      <Footer />
    </div>
  );
}

export function LegalSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`legal-section-${number}`}>
      <h2
        id={`legal-section-${number}`}
        className="text-base font-semibold text-zinc-100"
      >
        <span className="mr-2 font-mono text-xs text-safety">{number}</span>
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-zinc-400">{children}</div>
    </section>
  );
}
