"use client";

import { forwardRef } from "react";
import {
  Turnstile,
  type TurnstileInstance,
  type TurnstileProps,
} from "@marsidev/react-turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

export function isTurnstileEnabled(): boolean {
  return SITE_KEY.length > 0;
}

export type TurnstileWidgetProps = {
  onTokenChange: (token: string | null) => void;
  className?: string;
  options?: TurnstileProps["options"];
};

/**
 * Cloudflare Turnstile wrapper for Supabase Auth captchaToken.
 * Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (local/dev).
 */
export const TurnstileWidget = forwardRef<
  TurnstileInstance | undefined,
  TurnstileWidgetProps
>(function TurnstileWidget(
  { onTokenChange, className = "", options },
  ref,
) {
  if (!SITE_KEY) return null;

  return (
    <div className={`flex justify-center ${className}`.trim()}>
      <Turnstile
        ref={ref}
        siteKey={SITE_KEY}
        options={{
          theme: "auto",
          size: "normal",
          ...options,
        }}
        onSuccess={(token) => onTokenChange(token)}
        onExpire={() => onTokenChange(null)}
        onError={() => onTokenChange(null)}
      />
    </div>
  );
});
