import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  billingPaisePerVehicleYear,
  billingPeriodDays,
  listRupeesPerVehicleYear,
  rupeesPerVehicleYear,
  trialDays,
} from './config.ts';


export interface SubscriptionRow {
  id: string;
  user_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  vehicle_qty: number;
  amount_paise_per_vehicle: number;
}

export interface EntitlementRow {
  vehicle_id: string;
  user_id: string;
  active_until: string;
  source: string;
}

export function isEntitlementActive(activeUntil: string | null | undefined): boolean {
  if (!activeUntil) return false;
  const t = new Date(activeUntil).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

export async function getSubscription(
  admin: SupabaseClient,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await admin
    .from('subscriptions')
    .select(
      'id, user_id, status, trial_ends_at, current_period_end, vehicle_qty, amount_paise_per_vehicle',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
  return (data as SubscriptionRow | null) ?? null;
}

export async function getEntitlement(
  admin: SupabaseClient,
  vehicleId: string,
): Promise<EntitlementRow | null> {
  const { data, error } = await admin
    .from('vehicle_entitlements')
    .select('vehicle_id, user_id, active_until, source')
    .eq('vehicle_id', vehicleId)
    .maybeSingle();
  if (error) throw new Error(`entitlement lookup failed: ${error.message}`);
  return (data as EntitlementRow | null) ?? null;
}

export async function countUserVehicles(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new Error(`vehicle count failed: ${error.message}`);
  return count ?? 0;
}

export type ClaimGateResult =
  | { ok: true; mode: 'trial' | 'subscription' }
  | { ok: false; code: 'PAYMENT_REQUIRED'; message: string; vehicleQtyNeeded: number };

/**
 * First vehicle → trial. Additional vehicles need subscription.vehicle_qty coverage.
 */
export async function assertCanClaimVehicle(
  admin: SupabaseClient,
  userId: string,
): Promise<ClaimGateResult> {
  const existingCount = await countUserVehicles(admin, userId);
  const sub = await getSubscription(admin, userId);

  if (existingCount === 0) {
    return { ok: true, mode: 'trial' };
  }

  const periodOk =
    sub &&
    (sub.status === 'active' || sub.status === 'trial') &&
    isEntitlementActive(sub.current_period_end ?? sub.trial_ends_at);

  if (periodOk && sub && sub.vehicle_qty >= existingCount + 1) {
    return { ok: true, mode: 'subscription' };
  }

  const needed = existingCount + 1;
  const rupees = needed * rupeesPerVehicleYear();
  const list = needed * listRupeesPerVehicleYear();
  return {
    ok: false,
    code: 'PAYMENT_REQUIRED',
    vehicleQtyNeeded: needed,
    message:
      `Payment required for vehicle #${needed}. ` +
      `₹1/day per vehicle — annual prepaid ₹${rupees.toFixed(0)} for ${needed} vehicle(s)/year ` +
      `(save 1 month vs ₹${list}). Open Billing to subscribe, then claim again.`,
  };
}


export async function grantVehicleEntitlement(
  admin: SupabaseClient,
  userId: string,
  vehicleId: string,
  mode: 'trial' | 'subscription' | 'admin_grant',
): Promise<void> {
  const sub = await getSubscription(admin, userId);
  let activeUntil: Date;
  let source: 'trial' | 'subscription' | 'admin_grant' = mode;

  if (mode === 'trial') {
    activeUntil = new Date(Date.now() + trialDays() * 24 * 60 * 60 * 1000);
    source = 'trial';
    await upsertSubscription(admin, userId, {
      status: 'trial',
      trial_ends_at: activeUntil.toISOString(),
      current_period_start: new Date().toISOString(),
      current_period_end: activeUntil.toISOString(),
      vehicle_qty: Math.max(sub?.vehicle_qty ?? 0, 1),
    });
  } else {
    const end = sub?.current_period_end
      ? new Date(sub.current_period_end)
      : new Date(Date.now() + billingPeriodDays() * 24 * 60 * 60 * 1000);
    activeUntil = end;
    source = mode === 'admin_grant' ? 'admin_grant' : 'subscription';
  }


  const { error } = await admin.from('vehicle_entitlements').upsert(
    {
      vehicle_id: vehicleId,
      user_id: userId,
      active_until: activeUntil.toISOString(),
      source,
    },
    { onConflict: 'vehicle_id' },
  );
  if (error) throw new Error(`entitlement upsert failed: ${error.message}`);
}

export async function upsertSubscription(
  admin: SupabaseClient,
  userId: string,
  patch: {
    status: string;
    trial_ends_at?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    vehicle_qty?: number;
    razorpay_customer_id?: string | null;
    razorpay_last_order_id?: string | null;
    razorpay_subscription_id?: string | null;
  },
): Promise<void> {
  const row = {
    user_id: userId,
    status: patch.status,
    trial_ends_at: patch.trial_ends_at ?? null,
    current_period_start: patch.current_period_start ?? null,
    current_period_end: patch.current_period_end ?? null,
    vehicle_qty: patch.vehicle_qty ?? 0,
    amount_paise_per_vehicle: billingPaisePerVehicleYear(),

    razorpay_customer_id: patch.razorpay_customer_id ?? null,
    razorpay_last_order_id: patch.razorpay_last_order_id ?? null,
    razorpay_subscription_id: patch.razorpay_subscription_id ?? null,
  };

  const { error } = await admin.from('subscriptions').upsert(row, {
    onConflict: 'user_id',
  });
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
}

/** Activate / renew prepaid period for vehicleQty and entitle all current vehicles. */
export async function activatePaidPeriod(
  admin: SupabaseClient,
  userId: string,
  vehicleQty: number,
  orderId: string | null,
): Promise<{ periodEnd: string; entitled: number }> {
  const qty = Math.max(1, Math.floor(vehicleQty));
  const start = new Date();
  const end = new Date(
    start.getTime() + billingPeriodDays() * 24 * 60 * 60 * 1000,
  );


  await upsertSubscription(admin, userId, {
    status: 'active',
    current_period_start: start.toISOString(),
    current_period_end: end.toISOString(),
    vehicle_qty: qty,
    razorpay_last_order_id: orderId,
  });

  const { data: vehicles, error } = await admin
    .from('vehicles')
    .select('id')
    .eq('user_id', userId);
  if (error) throw new Error(`list vehicles failed: ${error.message}`);

  const rows = (vehicles ?? []).map((v: { id: string }) => ({
    vehicle_id: v.id,
    user_id: userId,
    active_until: end.toISOString(),
    source: 'subscription' as const,
  }));

  if (rows.length > 0) {
    const { error: entErr } = await admin
      .from('vehicle_entitlements')
      .upsert(rows, { onConflict: 'vehicle_id' });
    if (entErr) throw new Error(`entitle vehicles failed: ${entErr.message}`);
  }

  return { periodEnd: end.toISOString(), entitled: rows.length };
}

export async function assertVehicleEntitledForRefresh(
  admin: SupabaseClient,
  vehicleId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ent = await getEntitlement(admin, vehicleId);
  if (ent && isEntitlementActive(ent.active_until)) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      'Subscription expired or inactive for this vehicle. Renew under Billing (₹1/day · ₹329/vehicle/year prepaid) to refresh and keep alerts.',
  };
}

