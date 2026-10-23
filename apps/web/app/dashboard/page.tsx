"use client";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { GarageDashboard } from "@/components/dashboard/GarageDashboard";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <GarageDashboard />
    </AuthGuard>
  );
}
