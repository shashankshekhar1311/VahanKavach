"use client";

import { useState, type FormEvent } from "react";
import { ShieldPlus } from "lucide-react";
import { formatRegDisplay, isValidRegNumber } from "@/lib/registration";
import { Spinner } from "@/components/ui/Spinner";

interface QuickAddVehicleProps {
  onProtect: (regNumber: string) => Promise<void>;
  busy?: boolean;
}

export function QuickAddVehicle({ onProtect, busy = false }: QuickAddVehicleProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidRegNumber(value)) {
      setError("Enter a valid plate like KA 01 AB 1234");
      return;
    }

    try {
      await onProtect(value);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to protect vehicle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2"
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <label htmlFor="reg-number" className="sr-only">
            Quick add vehicle
          </label>
          <input
            id="reg-number"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Add plate · KA 01 AB 1234"
            value={value}
            disabled={busy}
            onChange={(e) => {
              setError(null);
              setValue(formatRegDisplay(e.target.value));
            }}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm tracking-wider text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-safety focus:outline-none focus:ring-1 focus:ring-safety disabled:opacity-60"
          />
          {busy && (
            <span className="pointer-events-none absolute inset-0 rounded-lg scanner-pulse" />
          )}
        </div>
        <button
          type="submit"
          disabled={busy || value.trim().length === 0}
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
      {error && (
        <p className="mt-1.5 px-0.5 text-xs text-emergency" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
