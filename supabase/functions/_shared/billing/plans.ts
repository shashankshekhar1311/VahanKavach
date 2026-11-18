/**
 * Multi-tier plans (unit prices × vehicleQty):
 *   free | adhoc_audit (₹19/credit) | fleet_pass (₹99/vehicle/7d) | pro_annual (₹399/vehicle/yr).
 * Pro: challan poll every 10 days + alert on new finds.
 * Live upstream sync is gated by assert_and_consume_live_sync (DB).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type SubscriptionTier =
  | 'free'
  | 'adhoc_audit'
  | 'pro_annual'
  | 'fleet_pass';

export type GatewayPaymentStatus =
  | 'pending'
  | 'successful'
  | 'failed'
  | 'refunded';

export type PaymentProvider = 'razorpay' | 'cashfree' | 'upi_intent';

export const PLAN_PRICE_PAISE: Record<SubscriptionTier, number> = {
  free: 0,
  adhoc_audit: 1_900,
  pro_annual: 39_900,
  fleet_pass: 9_900,
};

export const PLAN_PRICE_RUPEES: Record<SubscriptionTier, number> = {
  free: 0,
  adhoc_audit: 19,
  pro_annual: 399,
  fleet_pass: 99,
};

export const PAID_PLAN_TIERS: SubscriptionTier[] = [
  'adhoc_audit',
  'pro_annual',
  'fleet_pass',
];

export function isPaidPlanTier(tier: string): tier is Exclude<SubscriptionTier, 'free'> {
  return (PAID_PLAN_TIERS as string[]).includes(tier);
}

export function planPricePaise(tier: SubscriptionTier): number {
  return PLAN_PRICE_PAISE[tier];
}

export function planDisplayName(tier: SubscriptionTier): string {
  switch (tier) {
    case 'adhoc_audit':
      return 'Ad-hoc Audit';
    case 'pro_annual':
      return 'Kavach Pro Annual';
    case 'fleet_pass':
      return 'Fleet Pass';
    default:
      return 'Free Garage';
  }
}

export type UserEntitlementRow = {
  user_id: string;
  tier: SubscriptionTier;
  scan_credits_balance: number;
  tier_expires_at: string | null;
  max_vehicles: number | null;
};

export class LiveSyncEntitlementError extends Error {
  readonly status = 402;
  readonly code = 'LIVE_SYNC_PAYMENT_REQUIRED';
  constructor(message?: string) {
    super(
      message ??
        'Live VAHAN sync requires a paid plan or scan credit. ' +
          'Buy Ad-hoc (₹19/credit), Fleet Pass (₹99/vehicle/7d), or Kavach Pro (₹399/vehicle/yr). ' +
          'Free tier supports manual date tracking only.',
    );
    this.name = 'LiveSyncEntitlementError';
  }
}

/** Ensure wallet row exists; return current entitlement. */
export async function ensureUserEntitlement(
  admin: SupabaseClient,
  userId: string,
): Promise<UserEntitlementRow> {
  const { data, error } = await admin.rpc('ensure_user_entitlement', {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`ensure_user_entitlement failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as UserEntitlementRow | null;
  if (!row) {
    throw new Error('ensure_user_entitlement returned empty');
  }
  return row;
}

export async function getEffectiveTier(
  admin: SupabaseClient,
  userId: string,
): Promise<SubscriptionTier> {
  const { data, error } = await admin.rpc('get_effective_subscription_tier', {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`get_effective_subscription_tier failed: ${error.message}`);
  }
  const tier = String(data ?? 'free') as SubscriptionTier;
  return tier;
}

/**
 * DB-level gate before any paid upstream provider call.
 * Burns one scan credit unless an unlimited window (pro/fleet) is active.
 */
export async function assertAndConsumeLiveSync(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await admin.rpc('assert_and_consume_live_sync', {
    p_user_id: userId,
  });
  if (error) {
    console.error('assert_and_consume_live_sync failed', error.message);
    throw new LiveSyncEntitlementError(
      'Unable to verify live-sync entitlement. Please try again.',
    );
  }
  if (data !== true) {
    throw new LiveSyncEntitlementError();
  }
}

export async function createPendingPayment(
  admin: SupabaseClient,
  input: {
    userId: string;
    tier: Exclude<SubscriptionTier, 'free'>;
    amountPaise: number;
    provider?: PaymentProvider;
    providerOrderId?: string | null;
    vehicleQty?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('payments')
    .insert({
      user_id: input.userId,
      tier: input.tier,
      amount_paise: input.amountPaise,
      currency: 'INR',
      status: 'pending',
      provider: input.provider ?? 'razorpay',
      provider_order_id: input.providerOrderId ?? null,
      vehicle_qty: input.vehicleQty ?? 1,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`payments insert failed: ${error?.message ?? 'unknown'}`);
  }
  return { id: data.id as string };
}

export async function markPaymentSuccessful(
  admin: SupabaseClient,
  paymentId: string,
  providerPaymentId?: string | null,
  providerSignature?: string | null,
): Promise<UserEntitlementRow> {
  const { data, error } = await admin.rpc('mark_payment_successful', {
    p_payment_id: paymentId,
    p_provider_payment_id: providerPaymentId ?? null,
    p_provider_signature: providerSignature ?? null,
  });
  if (error) {
    throw new Error(`mark_payment_successful failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as UserEntitlementRow | null;
  if (!row) {
    throw new Error('mark_payment_successful returned empty');
  }
  return row;
}

export async function grantPlanPurchase(
  admin: SupabaseClient,
  userId: string,
  tier: Exclude<SubscriptionTier, 'free'>,
  paymentId?: string | null,
  vehicleQty = 1,
): Promise<UserEntitlementRow> {
  const { data, error } = await admin.rpc('grant_plan_purchase', {
    p_user_id: userId,
    p_tier: tier,
    p_payment_id: paymentId ?? null,
    p_vehicle_qty: vehicleQty,
  });
  if (error) {
    throw new Error(`grant_plan_purchase failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as UserEntitlementRow | null;
  if (!row) {
    throw new Error('grant_plan_purchase returned empty');
  }
  return row;
}
