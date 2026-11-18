"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const STORAGE_KEY = "vk_install_banner_dismissed_at";
const DISMISS_DAYS = 14;
const DISMISS_MS = DISMISS_DAYS * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return true;
  const mediaStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosStandalone;
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_MS;
  } catch {
    return false;
  }
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ may report as Mac; skip unless classic iOS UA.
  return ios && !(window as Window & { MSStream?: unknown }).MSStream;
}

type BannerMode = "android" | "ios" | null;

/**
 * Subtle install CTA for Android Chromium (beforeinstallprompt) and iOS Safari.
 * Hidden on desktop, standalone PWA, and for 14 days after dismiss.
 */
export function InstallAppBanner() {
  const [mode, setMode] = useState<BannerMode>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay() || isDismissedRecently()) {
      setMode(null);
      return;
    }

    if (isIosSafari()) {
      setMode("ios");
      return;
    }

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode("android");
    };

    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore quota / private mode
    }
    setMode(null);
    setDeferred(null);
  }

  async function install() {
    if (!deferred || busy) return;
    setBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
    } finally {
      setBusy(false);
      setDeferred(null);
      setMode(null);
    }
  }

  if (!mode) return null;

  return (
    <aside
      className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2"
      role="region"
      aria-label="Install VahanKavach"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-safety/15 text-safety">
        {mode === "ios" ? (
          <Share className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        {mode === "ios" ? (
          <p className="text-[11px] leading-snug text-zinc-400">
            Install VahanKavach: tap Share (↑) then &apos;Add to Home Screen&apos;
          </p>
        ) : (
          <p className="text-[11px] leading-snug text-zinc-400">
            Install VahanKavach on your home screen for faster access.
          </p>
        )}
      </div>

      {mode === "android" ? (
        <button
          type="button"
          disabled={busy || !deferred}
          onClick={() => void install()}
          className="shrink-0 rounded-lg bg-safety/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          Install App
        </button>
      ) : null}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install banner"
        className="shrink-0 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </aside>
  );
}
