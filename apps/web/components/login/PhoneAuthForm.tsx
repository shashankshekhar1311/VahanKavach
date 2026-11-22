"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Shield, Smartphone } from "lucide-react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

import { supabase } from "@/lib/supabase";
import {
  formatMobileInput,
  isValidIndianMobile,
  toE164Indian,
} from "@/lib/phone";
import {
  isTurnstileEnabled,
  TurnstileWidget,
} from "@/components/auth/TurnstileWidget";
import { Spinner } from "@/components/ui/Spinner";

type Channel = "email" | "phone";
type Step = "identity" | "otp";

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

const allowStagingSandbox =
  process.env.NEXT_PUBLIC_ENVIRONMENT === "staging" ||
  process.env.NEXT_PUBLIC_ENABLE_SANDBOX_LOGIN === "true";

export function PhoneAuthForm() {
  const router = useRouter();
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const captchaRequired = isTurnstileEnabled();
  /** Prefer phone OTP (Fast2SMS hook); email remains available as fallback. */
  const [channel, setChannel] = useState<Channel>("phone");
  const [step, setStep] = useState<Step>("identity");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [email, setEmail] = useState("");
  const [e164, setE164] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function resetCaptcha() {
    setCaptchaToken(null);
    turnstileRef.current?.reset();
  }

  function switchChannel(next: Channel) {
    if (busy) return;
    setChannel(next);
    setStep("identity");
    setOtp("");
    setError(null);
    setInfo(null);
    resetCaptcha();
  }

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (captchaRequired && !captchaToken) {
      setError("Complete the CAPTCHA check before continuing.");
      return;
    }

    if (channel === "email") {
      const normalized = email.trim().toLowerCase();
      if (!isValidEmail(normalized)) {
        setError("Enter a valid email address");
        return;
      }

      setBusy(true);
      try {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: normalized,
          options: {
            shouldCreateUser: true,
            ...(captchaToken ? { captchaToken } : {}),
          },
        });

        if (otpError) {
          setError(friendlyOtpError(otpError.message));
          return;
        }

        setPendingEmail(normalized);
        setE164(null);
        setStep("otp");
        setInfo("OTP sent to email. Enter the 6-digit code.");
      } finally {
        setBusy(false);
        resetCaptcha();
      }
      return;
    }

    if (!isValidIndianMobile(phoneDisplay)) {
      setError("Enter a valid 10-digit Indian mobile number");
      return;
    }

    const phone = toE164Indian(phoneDisplay);
    if (!phone) {
      setError("Invalid phone number");
      return;
    }

    setBusy(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone,
        options: {
          shouldCreateUser: true,
          ...(captchaToken ? { captchaToken } : {}),
        },
      });

      if (otpError) {
        setError(friendlyOtpError(otpError.message));
        return;
      }

      setE164(phone);
      setPendingEmail(null);
      setStep("otp");
      setInfo("OTP sent via SMS. Enter the 6-digit code.");
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = otp.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Enter the 6-digit OTP");
      return;
    }

    setBusy(true);

    if (channel === "email") {
      if (!pendingEmail) {
        setBusy(false);
        setError("Email session expired. Re-enter your email.");
        setStep("identity");
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token,
        type: "email",
      });
      setBusy(false);

      if (verifyError) {
        setError(verifyError.message);
        return;
      }

      router.replace("/dashboard");
      return;
    }

    if (!e164) {
      setBusy(false);
      setError("Phone session expired. Re-enter your number.");
      setStep("identity");
      return;
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: e164,
      token,
      type: "sms",
    });
    setBusy(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    router.replace("/dashboard");
  }

  /** Staging-only sandbox password login when SMTP / SMS hook is unavailable. */
  async function demoLogin() {
    if (!allowStagingSandbox) {
      setError("Sandbox login is disabled outside staging.");
      return;
    }
    if (captchaRequired && !captchaToken) {
      setError("Complete the CAPTCHA check before continuing.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const sandboxPassword =
        process.env.NEXT_PUBLIC_STAGING_SANDBOX_PASSWORD?.trim() ?? "";
      if (!sandboxPassword) {
        setError("Staging sandbox password is not configured.");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: "sandbox@vahankavach.test",
        password: sandboxPassword,
        ...(captchaToken
          ? { options: { captchaToken } }
          : {}),
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.replace("/dashboard");
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  function friendlyOtpError(message: string): string {
    const lower = message.toLowerCase();
    if (
      lower.includes("confirmation email") ||
      lower.includes("error sending") ||
      lower.includes("smtp")
    ) {
      return "Email OTP is unavailable (SMTP misconfigured). Use Phone OTP, or Continue with staging sandbox account.";
    }
    if (
      lower.includes("hook") ||
      lower.includes("sms") ||
      lower.includes("reach hook")
    ) {
      return "SMS OTP hook failed. Use Continue with staging sandbox account, or retry phone OTP shortly.";
    }
    if (lower.includes("captcha") || lower.includes("turnstile")) {
      return "CAPTCHA verification failed. Complete the check again and retry.";
    }
    return message;
  }

  const captchaBlocking = captchaRequired && !captchaToken;

  return (
    <div className="flex flex-1 flex-col justify-center gap-8 py-10">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-safety/15 ring-1 ring-safety/40">
          <Shield className="h-7 w-7 text-safety" strokeWidth={2.25} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
          VahanKavach
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Your Automated Vehicle Shield
        </p>
        <Link
          href="/demo"
          className="mt-3 inline-block text-xs font-medium text-safety underline-offset-2 hover:underline"
        >
          Watch 30s demo →
        </Link>
      </div>

      {step === "identity" ? (
        <form onSubmit={sendOtp} className="space-y-4">
          <div
            className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1"
            role="tablist"
            aria-label="Login method"
          >
            <button
              type="button"
              role="tab"
              aria-selected={channel === "email"}
              disabled={busy}
              onClick={() => switchChannel("email")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                channel === "email"
                  ? "bg-safety/20 text-safety"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={channel === "phone"}
              disabled={busy}
              onClick={() => switchChannel("phone")}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                channel === "phone"
                  ? "bg-safety/20 text-safety"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Phone
            </button>
          </div>

          {channel === "email" ? (
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500"
              >
                Email address
              </label>
              <div className="flex overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 focus-within:border-safety focus-within:ring-1 focus-within:ring-safety">
                <span className="flex items-center border-r border-zinc-800 px-3 text-zinc-400">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  disabled={busy}
                  onChange={(e) => {
                    setError(null);
                    setEmail(e.target.value);
                  }}
                  className="w-full bg-transparent px-3 py-3.5 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          ) : (
            <div>
              <label
                htmlFor="phone"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500"
              >
                Mobile number
              </label>
              <div className="flex overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 focus-within:border-safety focus-within:ring-1 focus-within:ring-safety">
                <span className="flex items-center gap-1.5 border-r border-zinc-800 px-3 text-sm text-zinc-400">
                  <Smartphone className="h-4 w-4" />
                  +91
                </span>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  value={phoneDisplay}
                  disabled={busy}
                  onChange={(e) => {
                    setError(null);
                    setPhoneDisplay(formatMobileInput(e.target.value));
                  }}
                  className="w-full bg-transparent px-3 py-3.5 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          )}

          <TurnstileWidget
            ref={turnstileRef}
            onTokenChange={setCaptchaToken}
          />

          {captchaRequired && !captchaToken ? (
            <p className="text-center text-[11px] text-zinc-500">
              Complete the CAPTCHA to enable sign-in.
            </p>
          ) : null}

          {error && (
            <p className="text-sm text-emergency" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || captchaBlocking}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-safety py-3.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-60 active:scale-[0.98]"
          >
            {busy ? <Spinner /> : null}
            {channel === "email" ? "Send email OTP" : "Send SMS OTP"}
          </button>

          {allowStagingSandbox ? (
            <>
              <button
                type="button"
                onClick={demoLogin}
                disabled={busy || captchaBlocking}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900/80 py-3 text-xs font-medium text-zinc-200 transition hover:border-safety/50 hover:text-safety disabled:opacity-50"
              >
                Continue with staging sandbox account
              </button>
              <p className="text-center text-[11px] text-zinc-600">
                Staging only · use when email/SMS OTP is down
              </p>
            </>
          ) : null}
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-4">
          <div>
            <label
              htmlFor="otp"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              6-digit OTP
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={otp}
              disabled={busy}
              onChange={(e) => {
                setError(null);
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3.5 text-center font-mono text-2xl tracking-[0.4em] text-zinc-100 placeholder:tracking-[0.4em] placeholder:text-zinc-700 focus:border-safety focus:outline-none focus:ring-1 focus:ring-safety disabled:opacity-60"
            />
            <p className="mt-2 text-center text-xs text-zinc-500">
              Sent to {pendingEmail ?? e164}
            </p>
          </div>

          {info && <p className="text-center text-xs text-safety">{info}</p>}
          {error && (
            <p className="text-sm text-emergency" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || otp.length !== 6}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-safety py-3.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-60 active:scale-[0.98]"
          >
            {busy ? <Spinner /> : null}
            Verify & continue
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setStep("identity");
              setOtp("");
              setError(null);
              setInfo(null);
              resetCaptcha();
            }}
            className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
          >
            {channel === "email" ? "Change email" : "Change number"}
          </button>
        </form>
      )}

      <p className="text-center text-[11px] leading-relaxed text-zinc-600">
        By continuing you agree to secure processing of vehicle RC, PUC, and
        e-challan data for compliance alerts.
      </p>
    </div>
  );
}
