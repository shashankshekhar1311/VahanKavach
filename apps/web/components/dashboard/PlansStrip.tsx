"use client";

import { CreditCard, Gauge, Sparkles, Zap } from "lucide-react";
import {
  ADHOC_AUDIT_RUPEES,
  ANNUAL_PREPAID_RUPEES_PER_VEHICLE,
  CHALLAN_POLL_DAYS,
  FLEET_PASS_DAYS,
  FLEET_PASS_RUPEES,
  type PlanTier,
} from "@/lib/pricing";

export type SelectablePlan = Exclude<PlanTier, "free">;

const PLANS: Array<{
  id: SelectablePlan;
  name: string;
  price: string;
  period: string;
  blurb: string;
  icon: typeof Zap;
  accent: string;
  featured?: boolean;
}> = [
  {
    id: "adhoc_audit",
    name: "Ad-hoc",
    price: `₹${ADHOC_AUDIT_RUPEES}`,
    period: "1 live sync",
    blurb: "One-time VAHAN check",
    icon: Zap,
    accent: "border-amber-500/35 bg-amber-500/10",
  },
  {
    id: "fleet_pass",
    name: "Fleet",
    price: `₹${FLEET_PASS_RUPEES}`,
    period: `${FLEET_PASS_DAYS} days`,
    blurb: "Short burst monitoring",
    icon: Gauge,
    accent: "border-sky-500/35 bg-sky-500/10",
  },
  {
    id: "pro_annual",
    name: "Pro",
    price: `₹${ANNUAL_PREPAID_RUPEES_PER_VEHICLE}`,
    period: "/ year",
    blurb: `Challan every ${CHALLAN_POLL_DAYS} days`,
    icon: Sparkles,
    accent: "border-safety/45 bg-safety/15",
    featured: true,
  },
];

interface PlansStripProps {
  title?: string;
  subtitle?: string;
  onSelect: (tier: SelectablePlan) => void;
  busy?: boolean;
}

/** Mobile-first plan chooser — replaces the one-line entitlement wall of text. */
export function PlansStrip({
  title = "Choose a plan",
  subtitle = `Manual dates are free. Live sync: ₹${ADHOC_AUDIT_RUPEES} once · ₹${FLEET_PASS_RUPEES}/${FLEET_PASS_DAYS}d · ₹${ANNUAL_PREPAID_RUPEES_PER_VEHICLE}/yr (challan every ${CHALLAN_POLL_DAYS} days).`,
  onSelect,
  busy = false,
}: PlansStripProps) {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70"
      aria-label="Subscription plans"
    >
      <div className="border-b border-zinc-800/80 px-3.5 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-safety/15 text-safety">
            <CreditCard className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-50">{title}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-2.5">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <button
              key={plan.id}
              type="button"
              disabled={busy}
              onClick={() => onSelect(plan.id)}
              className={`relative flex flex-col items-stretch rounded-xl border px-2 py-2.5 text-left transition active:scale-[0.98] disabled:opacity-50 ${plan.accent} ${
                plan.featured
                  ? "ring-1 ring-safety/40"
                  : "hover:brightness-110"
              }`}
            >
              {plan.featured ? (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-safety px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-zinc-950">
                  Best
                </span>
              ) : null}
              <span className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-zinc-950/40 text-zinc-100">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {plan.name}
              </span>
              <span className="mt-0.5 text-base font-bold tabular-nums text-zinc-50">
                {plan.price}
                <span className="ml-0.5 text-[9px] font-medium text-zinc-500">
                  {plan.period}
                </span>
              </span>
              <span className="mt-1 text-[9px] leading-snug text-zinc-500">
                {plan.blurb}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
