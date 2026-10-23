"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const DISMISS_KEY = "vk_sandbox_banner_dismissed";

/**
 * Sticky dismissible banner shown when NEXT_PUBLIC_ENVIRONMENT === "staging".
 */
export function SandboxBanner() {
  const isStaging = process.env.NEXT_PUBLIC_ENVIRONMENT === "staging";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStaging) return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setVisible(true);
  }, [isStaging]);

  if (!isStaging || !visible) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-3 py-2 text-amber-100 backdrop-blur-md"
    >
      <p className="min-w-0 flex-1 text-center text-xs font-medium leading-snug sm:text-sm">
        ⚠️ Sandbox Environment • Connected to Staging Database • Alerts route to
        @VahanKavachDevBot
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-amber-200/80 transition hover:bg-amber-500/20 hover:text-amber-50"
        aria-label="Dismiss sandbox banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
