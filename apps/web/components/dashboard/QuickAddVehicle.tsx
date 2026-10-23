"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, FlaskConical, Plus, ShieldPlus, X } from "lucide-react";
import { buildVehicleConsentLabel } from "@/lib/consent";
import { formatRegDisplay, isValidRegNumber } from "@/lib/registration";
import { Spinner } from "@/components/ui/Spinner";

/** Sandbox mock fixtures — chassis last-5 must match MockVehicleProvider. */
export const SANDBOX_TEST_VEHICLES = [
  {
    regNumber: "KA01AB1234",
    chassisLast5: "A1B2C",
    label: "Clean — valid PUC (180d)",
  },
  {
    regNumber: "KA02CD5678",
    chassisLast5: "C3D4E",
    label: "Urgent — expired PUC + 2 ANPR challans",
  },
  {
    regNumber: "DL01EF9012",
    chassisLast5: "E5F6G",
    label: "Warning — PUC in 3 days + parking",
  },
] as const;

interface QuickAddVehicleProps {
  onProtect: (regNumber: string, chassisLast5: string) => Promise<void>;
  busy?: boolean;
  /** When true, show only a compact "Add vehicle" control until opened. */
  collapsed?: boolean;
  defaultOpen?: boolean;
}

function normalizeChassisInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

export function QuickAddVehicle({
  onProtect,
  busy = false,
  collapsed = false,
  defaultOpen = true,
}: QuickAddVehicleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState("");
  const [chassis, setChassis] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMenuOpen, setTestMenuOpen] = useState(false);
  const showSandboxTools =
    process.env.NEXT_PUBLIC_ENVIRONMENT === "staging" ||
    process.env.NEXT_PUBLIC_ENABLE_SANDBOX_FIXTURES === "true";

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);

  const regDisplay = formatRegDisplay(value) || "[REG_NO]";
  const consentLabel = buildVehicleConsentLabel(regDisplay);
  const canSubmit =
    !busy &&
    value.trim().length > 0 &&
    chassis.length === 5 &&
    consentChecked;

  function loadTestVehicle(fixture: (typeof SANDBOX_TEST_VEHICLES)[number]) {
    setError(null);
    setValue(fixture.regNumber);
    setChassis(fixture.chassisLast5);
    setConsentChecked(true);
    setTestMenuOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!consentChecked) {
      setError("Explicit consent is required before protecting a vehicle.");
      return;
    }

    if (!isValidRegNumber(value)) {
      setError("Enter a valid plate like KA 01 AB 1234");
      return;
    }

    const chassisLast5 = normalizeChassisInput(chassis);
    if (chassisLast5.length !== 5) {
      setError("Enter the last 5 characters of the chassis number from your RC.");
      return;
    }

    try {
      await onProtect(value, chassisLast5);
      setValue("");
      setChassis("");
      setConsentChecked(false);
      if (collapsed) setOpen(false);
    } catch {
      /* parent sets banner */
    }
  }

  if (collapsed && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-safety/40 hover:bg-zinc-900 hover:text-safety"
      >
        <Plus className="h-4 w-4" />
        Add vehicle
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          {collapsed ? "Add vehicle" : "Protect a vehicle"}
        </p>
        <div className="flex items-center gap-1">
          {showSandboxTools ? (
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setTestMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
                aria-expanded={testMenuOpen}
                aria-haspopup="listbox"
              >
                <FlaskConical className="h-3 w-3" />
                Load Test Vehicle
                <ChevronDown className="h-3 w-3" />
              </button>
              {testMenuOpen ? (
                <ul
                  role="listbox"
                  className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl"
                >
                  {SANDBOX_TEST_VEHICLES.map((fixture) => (
                    <li key={fixture.regNumber}>
                      <button
                        type="button"
                        role="option"
                        className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-zinc-900"
                        onClick={() => loadTestVehicle(fixture)}
                      >
                        <span className="font-mono text-xs font-semibold text-safety">
                          {fixture.regNumber}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {fixture.label}
                        </span>
                        <span className="font-mono text-[9px] text-zinc-600">
                          chassis {fixture.chassisLast5}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {collapsed ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setTestMenuOpen(false);
              }}
              className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Close add vehicle"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 min-[380px]:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="protect-reg" className="sr-only">
            Registration number
          </label>
          <input
            id="protect-reg"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="KA 01 AB 1234"
            value={value}
            disabled={busy}
            onChange={(e) => {
              setError(null);
              setValue(e.target.value.toUpperCase());
            }}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm tracking-wider text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-safety focus:outline-none focus:ring-1 focus:ring-safety disabled:opacity-60"
          />
        </div>
        <div className="w-full min-[380px]:w-28">
          <label htmlFor="chassis-last5" className="sr-only">
            Chassis last 5
          </label>
          <input
            id="chassis-last5"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Chassis ×5"
            value={chassis}
            disabled={busy}
            maxLength={5}
            onChange={(e) => {
              setError(null);
              setChassis(normalizeChassisInput(e.target.value));
            }}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm tracking-wider text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-safety focus:outline-none focus:ring-1 focus:ring-safety disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-safety px-3 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
        >
          {busy ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <ShieldPlus className="h-4 w-4" />
          )}
          <span className="hidden min-[380px]:inline">Protect</span>
        </button>
      </div>

      <p className="mt-1.5 px-0.5 text-[10px] text-zinc-600">
        Ownership proof: last 5 of chassis from RC. Full chassis / engine and
        addresses are never stored.
        {showSandboxTools
          ? " Sandbox: use Load Test Vehicle for 1-click fixtures."
          : ""}
      </p>

      <label
        htmlFor="dpdp-vehicle-consent"
        className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-2.5 py-2"
      >
        <input
          id="dpdp-vehicle-consent"
          type="checkbox"
          checked={consentChecked}
          disabled={busy}
          onChange={(e) => {
            setError(null);
            setConsentChecked(e.target.checked);
          }}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-safety focus:ring-safety"
        />
        <span className="text-[10px] leading-snug text-zinc-400">
          {consentLabel}
        </span>
      </label>
      {error && (
        <p className="mt-1 px-0.5 text-xs text-emergency" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
