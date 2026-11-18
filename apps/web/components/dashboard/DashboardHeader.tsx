"use client";

import Link from "next/link";
import { LogOut, MapPin, Settings } from "lucide-react";
import type { NotificationChannel, Profile } from "@/lib/types";
import { formatPhoneDisplay } from "@/lib/format";

interface DashboardHeaderProps {
  profile: Profile | null;
  onSignOut: () => void;
}


function channelLabel(channel: NotificationChannel | undefined): string {
  switch (channel) {
    case "WHATSAPP":
      return "WhatsApp";
    case "TELEGRAM":
    case "SIGNAL":
    default:
      return "Telegram";
  }
}

export function DashboardHeader({ profile, onSignOut }: DashboardHeaderProps) {
  const name = profile?.full_name?.trim() || "Vehicle owner";
  const city = profile?.city?.trim() || "India";
  const phone = formatPhoneDisplay(profile?.phone_number);
  const channel = channelLabel(profile?.preferred_channel);
  const telegramLinked = Boolean(profile?.telegram_chat_id);

  return (
    <header className="flex items-center justify-between gap-3 pt-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-safety">
            Garage
          </span>
          <h1 className="truncate text-base font-semibold text-zinc-50">
            {name}
          </h1>
          {profile?.is_pro ? (
            <span
              className="shrink-0 rounded-md border border-safety/40 bg-safety/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-safety"
              title="Kavach Pro annual pass active"
            >
              Pro
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-zinc-500">
          <MapPin className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
          <span className="truncate">
            {city}
            {phone ? ` · ${phone}` : ""}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-safety/25 bg-safety/10 px-2 py-1 text-[10px] font-medium text-safety"
          title={
            telegramLinked
              ? `${channel} linked — alerts active`
              : `${channel} — link bot in Alerts below`
          }
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            {telegramLinked ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-safety opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-safety" />
              </>
            ) : (
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-500" />
            )}
          </span>
          {channel}
        </span>
        <Link
          href="/settings"
          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
