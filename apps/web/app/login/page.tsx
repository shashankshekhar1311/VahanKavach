"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { MobileShell } from "@/components/ui/MobileShell";
import { PhoneAuthForm } from "@/components/login/PhoneAuthForm";
import { Spinner } from "@/components/ui/Spinner";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && session) {
      router.replace("/dashboard");
    }
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8 text-safety" />
      </div>
    );
  }

  if (session) return null;

  return (
    <MobileShell>
      <PhoneAuthForm />
    </MobileShell>
  );
}
