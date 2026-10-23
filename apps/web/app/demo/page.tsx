import type { Metadata } from "next";
import Link from "next/link";
import { DemoVideo } from "@/components/DemoVideo";

export const metadata: Metadata = {
  title: "Demo — VahanKavach",
  description:
    "30-second VahanKavach product demo: garage monitoring, challan alerts, and Kavach Pro.",
};

/**
 * Standalone acquisition page for embedding / sharing the 30s demo.
 */
export default function DemoPage() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-8">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-safety">
              VahanKavach
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              See it in 30 seconds
            </h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              Private garage shield for PUC, insurance, and e-challan alerts —
              independent software, not affiliated with MoRTH or Parivahan.
            </p>
          </div>
          <Link
            href="/login"
            className="shrink-0 rounded-lg bg-safety px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Start free
          </Link>
        </header>

        <DemoVideo className="rounded-2xl border border-zinc-800 ring-1 ring-safety/10" />

        <ol className="mt-8 grid gap-3 text-sm text-zinc-400 sm:grid-cols-5">
          {[
            "Brand",
            "Your garage",
            "Challan alert",
            "Daily monitoring",
            "₹329/year",
          ].map((label, i) => (

            <li
              key={label}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2"
            >
              <span className="font-mono text-[10px] text-safety">
                0{i * 6}s
              </span>
              <p className="mt-0.5 font-medium text-zinc-200">{label}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
