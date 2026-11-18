"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, Trash2 } from "lucide-react";
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
  const { profile, refreshProfile, signOut, user } = useAuth();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [showSupportId, setShowSupportId] = useState(false);

  useEffect(() => {
    setNameDraft(profile?.full_name?.trim() ?? "");
  }, [profile?.full_name]);

  // Backfill profiles.phone_number from auth phone when missing (OTP signups).
  useEffect(() => {
    if (!user?.id) return;
    const authPhone = user.phone?.trim() || null;
    if (!authPhone) return;
    if (profile?.phone_number?.trim()) return;

    let cancelled = false;
    void (async () => {
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ phone_number: authPhone })
        .eq("id", user.id);
      if (cancelled || updErr) return;
      await refreshProfile();
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.phone, profile?.phone_number, refreshProfile]);

  const displayPhone =
    profile?.phone_number?.trim() || user?.phone?.trim() || null;
  const phoneLabel = displayPhone
    ? formatPhoneDisplay(displayPhone)
    : "Not set";
  const nameDirty =
    nameDraft.trim() !== (profile?.full_name?.trim() ?? "");

  async function handleSaveName() {
    if (!user) return;
    const next = nameDraft.trim();
    setSavingName(true);
    setNameMsg(null);
    try {
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ full_name: next.length > 0 ? next : null })
        .eq("id", user.id);
      if (updErr) throw updErr;
      await refreshProfile();
      setNameMsg(next ? "Name saved." : "Name cleared.");
    } catch (err) {
      setNameMsg(err instanceof Error ? err.message : "Could not save name");
    } finally {
      setSavingName(false);
    }
  }

  async function copyAccountRef() {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      setNameMsg("Could not copy account reference");
    }
  }

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
        <dl className="mt-2 space-y-3 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">
              Display name
            </dt>
            <dd className="mt-1 flex gap-2">
              <input
                type="text"
                value={nameDraft}
                disabled={savingName || !user}
                onChange={(e) => {
                  setNameMsg(null);
                  setNameDraft(e.target.value);
                }}
                placeholder="Add your name"
                maxLength={80}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-safety focus:outline-none focus:ring-1 focus:ring-safety disabled:opacity-50"
              />
              <button
                type="button"
                disabled={savingName || !user || !nameDirty}
                onClick={() => void handleSaveName()}
                className="shrink-0 rounded-lg bg-safety/90 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingName ? <Spinner className="h-3.5 w-3.5" /> : "Save"}
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-zinc-600">
              Phone
            </dt>
            <dd
              className={
                displayPhone
                  ? "mt-0.5 font-mono text-zinc-200"
                  : "mt-0.5 text-zinc-500"
              }
            >
              {phoneLabel}
            </dd>
            {!displayPhone ? (
              <p className="mt-0.5 text-[10px] text-zinc-600">
                Filled automatically when you sign in with mobile OTP.
              </p>
            ) : null}
          </div>
        </dl>

        {nameMsg ? (
          <p className="mt-2 text-[11px] text-zinc-500" role="status">
            {nameMsg}
          </p>
        ) : null}

        <div className="mt-3 border-t border-zinc-800/80 pt-2">
          <button
            type="button"
            onClick={() => setShowSupportId((v) => !v)}
            className="text-[10px] font-medium uppercase tracking-wide text-zinc-600 transition hover:text-zinc-400"
            aria-expanded={showSupportId}
          >
            {showSupportId ? "Hide support reference" : "Support reference"}
          </button>
          {showSupportId && user?.id ? (
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
                {user.id}
              </code>
              <button
                type="button"
                onClick={() => void copyAccountRef()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Copy account reference"
              >
                {copiedId ? (
                  <Check className="h-3 w-3 text-safety" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copy
              </button>
            </div>
          ) : null}
        </div>
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
