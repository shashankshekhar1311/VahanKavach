"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useAuth } from "@/components/auth/AuthProvider";
import { MobileShell } from "@/components/ui/MobileShell";
import { Spinner } from "@/components/ui/Spinner";
import { formatPhoneDisplay } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}

function SettingsContent() {
  const { profile, signOut, user } = useAuth();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    if (confirmText !== "DELETE") return;
    setDeleting(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "delete-account",
        { body: { confirm: "DELETE" } },
      );

      let payload = data as { success?: boolean; error?: string } | null;

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            payload = (await ctx.json()) as {
              success?: boolean;
              error?: string;
            };
          } catch {
            /* ignore */
          }
        }
        throw new Error(
          payload?.error || fnError.message || "delete-account failed",
        );
      }

      if (!payload?.success) {
        throw new Error(payload?.error ?? "Account deletion failed");
      }

      await signOut();
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account deletion failed");
      setDeleting(false);
    }
  }

  return (
    <MobileShell>
      <div className="flex items-center gap-2 pt-3">
        <Link
          href="/dashboard"
          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Back to garage"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-base font-semibold text-zinc-50">Settings</h1>
      </div>

      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Account
        </h2>
        <dl className="mt-2 space-y-2 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">
              Name
            </dt>
            <dd className="text-zinc-200">
              {profile?.full_name?.trim() || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">
              Phone
            </dt>
            <dd className="font-mono text-zinc-200">
              {formatPhoneDisplay(profile?.phone_number) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">
              User ID
            </dt>
            <dd className="truncate font-mono text-[11px] text-zinc-500">
              {user?.id ?? "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-emergency/40 bg-emergency/5 p-3">
        <h2 className="text-sm font-semibold text-emergency">
          Danger Zone: Delete Account &amp; All Data
        </h2>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          Permanently erase your VahanKavach account, vehicles, challans,
          consent logs, notification links, and billing records. This cannot be
          undone (DPDP Act 2023 — right to erasure).
        </p>
        <button
          type="button"
          onClick={() => {
            setConfirmText("");
            setError(null);
            setModalOpen(true);
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emergency/50 bg-emergency/15 px-3 py-2 text-xs font-semibold text-emergency transition hover:bg-emergency/25"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Delete account &amp; all data
        </button>
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-xl">
            <h3
              id="delete-account-title"
              className="text-sm font-semibold text-zinc-50"
            >
              Confirm permanent deletion
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Step 1 of 2: This will call our secure erasure endpoint and remove
              your auth identity. Type{" "}
              <span className="font-mono font-semibold text-emergency">
                DELETE
              </span>{" "}
              below to enable confirmation (step 2).
            </p>
            <label htmlFor="delete-confirm" className="sr-only">
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              disabled={deleting}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Type "DELETE"'
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emergency focus:outline-none focus:ring-1 focus:ring-emergency"
            />
            {error ? (
              <p className="mt-2 text-xs text-emergency" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setModalOpen(false)}
                className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || confirmText !== "DELETE"}
                onClick={() => void handleDeleteAccount()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emergency px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? <Spinner className="h-3.5 w-3.5" /> : null}
                Confirm delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </MobileShell>
  );
}
