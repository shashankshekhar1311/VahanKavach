import Link from "next/link";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { LEGAL } from "@/lib/legal";

const POLICY_LINKS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund", label: "Cancellation & Refunds" },
  { href: "/contact", label: "Contact / Grievance" },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/90">
      <div className="mx-auto w-full max-w-[480px] space-y-3 px-4 py-5 md:max-w-3xl">
        <DisclaimerBanner variant="footer" />

        <nav
          aria-label="Legal and policy links"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px]"
        >
          {POLICY_LINKS.map((link, i) => (
            <span key={link.href} className="inline-flex items-center gap-3">
              {i > 0 ? (
                <span className="text-zinc-700" aria-hidden>
                  ·
                </span>
              ) : null}
              <Link
                href={link.href}
                className="font-medium text-zinc-400 underline-offset-2 transition hover:text-safety hover:underline"
              >
                {link.label}
              </Link>
            </span>
          ))}
        </nav>

        <p className="text-center text-[10px] leading-relaxed text-zinc-600">
          © {year} {LEGAL.companyLegalName}. {LEGAL.productName} is a private
          software product. Not a government website.
        </p>
      </div>
    </footer>
  );
}
