"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import type { NotificationChannel, Profile } from "@/lib/types";

const CHANNELS: Array<{
  id: NotificationChannel;
  label: string;
  enabled: boolean;
}> = [
  { id: "TELEGRAM", label: "Telegram", enabled: true },
  { id: "WHATSAPP", label: "WhatsApp", enabled: false },
];

function randomLinkToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function telegramDeepLink(token: string): string | null {
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME?.replace(/^@/, "").trim();
  if (!bot || !token) return null;
  return `https://t.me/${bot}?start=${encodeURIComponent(token)}`;
}

interface NotificationPreferencesProps {
  profile: Profile | null;
}

export function NotificationPreferences({ profile }: NotificationPreferencesProps) {
  const { refreshProfile, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const channel = profile?.preferred_channel ?? "TELEGRAM";
  const linked = Boolean(profile?.telegram_chat_id);
  const deepLink = profile?.telegram_link_token
    ? telegramDeepLink(profile.telegram_link_token)
    : null;

  useEffect(() => {
    if (!linked) setExpanded(true);
  }, [linked]);

  // Park WhatsApp / Signal — migrate preference back to Telegram.
  useEffect(() => {
    if (!user) return;
    if (channel !== "WHATSAPP" && channel !== "SIGNAL") return;
    void (async () => {
      await supabase
        .from("profiles")
        .update({ preferred_channel: "TELEGRAM" })
        .eq("id", user.id);
      await refreshProfile();
    })();
  }, [user, channel, refreshProfile]);

  async function setPreferredChannel(next: NotificationChannel) {
    const meta = CHANNELS.find((c) => c.id === next);
    if (!user || next === channel || !meta?.enabled) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ preferred_channel: next })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      setMessage(`Alerts → ${meta.label}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update channel");
    } finally {
      setBusy(false);
    }
  }

  async function ensureTelegramToken(): Promise<string | null> {
    if (!user) return null;
    if (profile?.telegram_link_token) return profile.telegram_link_token;

    const token = randomLinkToken();
    const { error } = await supabase
      .from("profiles")
      .update({ telegram_link_token: token })
      .eq("id", user.id);
    if (error) throw error;
    await refreshProfile();
    return token;
  }

  async function handleConnectTelegram() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await ensureTelegramToken();
      if (!token) throw new Error("Could not create link token");

      const url = telegramDeepLink(token);
      if (!url) {
        throw new Error(
          "Set NEXT_PUBLIC_TELEGRAM_BOT_NAME in .env.local to enable Connect Telegram",
        );
      }

      window.open(url, "_blank", "noopener,noreferrer");
      setMessage("Opened Telegram — tap Start to finish linking.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyLink() {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await ensureTelegramToken();
      if (!token) throw new Error("Could not create link token");
      const url = telegramDeepLink(token);
      if (!url) {
        throw new Error("Set NEXT_PUBLIC_TELEGRAM_BOT_NAME in .env.local");
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setMessage("Deep link copied.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlinkTelegram() {
    if (!user || !linked) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          telegram_chat_id: null,
          telegram_link_token: null,
        })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
      setExpanded(true);
      setMessage("Telegram unlinked.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unlink failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2"
      aria-labelledby="notification-prefs-heading"
    >
      <div className="flex items-center gap-2">
        <h2
          id="notification-prefs-heading"
          className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-zinc-500"
        >
          Alerts
        </h2>

        <div
          className="flex min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5"
          role="radiogroup"
          aria-label="Preferred notification channel"
        >
          {CHANNELS.map((c) => {
            const selected =
              channel === c.id || (c.id === "TELEGRAM" && channel === "SIGNAL");
            const disabled = busy || !user || !c.enabled;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!c.enabled}
                disabled={disabled}
                title={c.enabled ? c.label : `${c.label} paused`}
                onClick={() => void setPreferredChannel(c.id)}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                  !c.enabled
                    ? "cursor-not-allowed text-zinc-600 opacity-50"
                    : selected
                      ? "bg-safety/15 text-safety"
                      : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {selected && c.enabled ? (
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                ) : null}
                {c.label}
              </button>
            );
          })}
        </div>

        {linked ? (
          <button
            type="button"
            disabled={busy || !user}
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300 disabled:opacity-50"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Manage"}
          </button>
        ) : null}
      </div>

      {(expanded || !linked) && (channel === "TELEGRAM" || channel === "SIGNAL") && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-2">
          <p className="min-w-0 flex-1 text-[11px] text-zinc-500">
            {linked ? (
              <>
                Linked
                {profile?.telegram_chat_id
                  ? ` · ${profile.telegram_chat_id}`
                  : ""}
              </>
            ) : (
              <>Connect the bot to receive alerts.</>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {!linked && (
              <>
                <button
                  type="button"
                  disabled={busy || !user}
                  onClick={() => void handleConnectTelegram()}
                  className="inline-flex items-center gap-1 rounded-md bg-safety px-2.5 py-1 text-[11px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <ExternalLink className="h-3 w-3" />
                  Connect
                </button>
                <button
                  type="button"
                  disabled={busy || !user}
                  onClick={() => void handleCopyLink()}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-safety" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Copy
                </button>
              </>
            )}
            {linked && (
              <button
                type="button"
                disabled={busy || !user}
                onClick={() => void handleUnlinkTelegram()}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                Unlink
              </button>
            )}
          </div>
          {deepLink && !linked && (
            <p className="w-full truncate font-mono text-[10px] text-zinc-600" title={deepLink}>
              {deepLink}
            </p>
          )}
        </div>
      )}

      {message && (
        <p className="mt-1.5 text-[11px] text-zinc-500" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
