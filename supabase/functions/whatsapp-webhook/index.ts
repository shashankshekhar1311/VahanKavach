/**
 * whatsapp-webhook — Module 3
 *
 * Meta WhatsApp Cloud API webhook listener + interactive compliance bot.
 *
 * GET  — Meta verification handshake (hub.mode / hub.verify_token / hub.challenge)
 * POST — HMAC-SHA256 signature check, then async conversational routing
 *
 * ---------------------------------------------------------------------------
 * Secrets (local: supabase/functions/.env | hosted: supabase secrets set)
 * ---------------------------------------------------------------------------
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN   — Meta webhook Verify Token
 *   META_APP_SECRET                 — Meta App Secret (HMAC)
 *   WHATSAPP_ACCESS_TOKEN           — Cloud API permanent / system user token
 *   WHATSAPP_PHONE_NUMBER_ID        — Sending phone number ID
 *   APP_BASE_URL                    — Onboarding / pay deep-links (optional)
 *   PAYMENT_PORTAL_URL              — Challan pay CTA URL (optional)
 *
 * Auto-injected by Supabase Edge Runtime:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Deploy note: verify_jwt = false (Meta cannot send a Supabase JWT).
 *
 * ---------------------------------------------------------------------------
 * curl examples (local: http://127.0.0.1:54321)
 * ---------------------------------------------------------------------------
 *
 * # Verify handshake
 * curl -s 'http://127.0.0.1:54321/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=12345'
 *
 * # Inbound text (signature skipped only if META_APP_SECRET unset in local mock)
 * curl -s -X POST 'http://127.0.0.1:54321/functions/v1/whatsapp-webhook' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"919876543210","id":"wamid.test","type":"text","text":{"body":"hi"}}]},"field":"messages"}]}]}'
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  markMessageAsRead,
  sendInteractiveButtons,
  sendTextMessage,
} from '../_shared/whatsapp.client.ts';
import { normalizeIndianPhone } from '../_shared/utils/phone.ts';

/** Supabase Edge Runtime background-task API. */
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const BUTTON_CHECK_CHALLANS = 'CHECK_CHALLANS';
const BUTTON_CHECK_PUC = 'CHECK_PUC';
const BUTTON_PAY_CHALLANS = 'PAY_CHALLANS';

const PUC_LEGAL_WARNING =
  '⚠️ Legal notice: Driving without a valid PUC certificate can attract fines under Section 190(2) of the Motor Vehicles Act (up to ₹1,000 first offence / ₹2,000 subsequent) and vehicle detention by traffic police.';

interface InboundMessage {
  messageId: string;
  fromRaw: string;
  type: 'text' | 'button_reply' | 'list_reply' | 'other';
  textBody: string | null;
  interactiveId: string | null;
}

interface ProfileRow {
  id: string;
  phone_number: string | null;
  full_name: string | null;
}

interface VehicleRow {
  id: string;
  reg_number: string;
  maker_model: string | null;
  puc_expiry_date: string | null;
}

interface ChallanRow {
  challan_number: string;
  amount: number | string;
  violation_date: string | null;
  violation_type: string | null;
  status: string;
  vehicle_id: string;
  vehicles: { reg_number: string } | { reg_number: string }[] | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    return handleVerification(req);
  }

  if (req.method === 'POST') {
    return handleWebhookPost(req);
  }

  return new Response('Method Not Allowed', { status: 405 });
});

// ---------------------------------------------------------------------------
// GET — Meta webhook verification challenge
// ---------------------------------------------------------------------------

function handleVerification(req: Request): Response {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN');

  if (!expected) {
    console.error('WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured');
    return new Response('Server misconfiguration', { status: 500 });
  }

  if (mode === 'subscribe' && token === expected && challenge) {
    console.log('WhatsApp webhook verified');
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — HMAC verify, ACK immediately, process async
// ---------------------------------------------------------------------------

async function handleWebhookPost(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const signatureHeader = req.headers.get('x-hub-signature-256');
  const appSecret = Deno.env.get('META_APP_SECRET');

  if (appSecret) {
    const valid = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
    if (!valid) {
      console.warn('Rejected WhatsApp webhook: invalid HMAC signature');
      return new Response('Forbidden', { status: 403 });
    }
  } else {
    // Local/dev only — production must set META_APP_SECRET.
    console.warn('META_APP_SECRET unset; skipping HMAC verification');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Acknowledge Meta immediately to avoid retry storms (5s timeout).
  const work = processWebhookPayload(payload).catch((err) => {
    console.error('whatsapp-webhook background error', err);
  });

  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    EdgeRuntime.waitUntil(work);
  } else {
    // Local edge-runtime may not expose waitUntil; still fire-and-forget.
    void work;
  }

  return new Response('EVENT_RECEIVED', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const providedHex = signatureHeader.slice('sha256='.length).toLowerCase();
  if (!/^[0-9a-f]+$/.test(providedHex) || providedHex.length !== 64) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expectedHex = bufferToHex(new Uint8Array(mac));

  return timingSafeEqualHex(providedHex, expectedHex);
}

function bufferToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time hex compare to reduce timing leaks. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Async event processing
// ---------------------------------------------------------------------------

async function processWebhookPayload(payload: unknown): Promise<void> {
  const messages = extractInboundMessages(payload);
  if (messages.length === 0) {
    return; // status updates, echoes, etc.
  }

  const supabase = createServiceClient();

  for (const msg of messages) {
    try {
      await handleInboundMessage(supabase, msg);
    } catch (err) {
      console.error('Failed handling inbound message', msg.messageId, err);
    }
  }
}

function extractInboundMessages(payload: unknown): InboundMessage[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as { object?: string }).object !== 'whatsapp_business_account'
  ) {
    return [];
  }

  const entry = (payload as { entry?: unknown[] }).entry;
  if (!Array.isArray(entry)) return [];

  const out: InboundMessage[] = [];

  for (const e of entry) {
    const changes = (e as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[] } })?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;

      for (const raw of messages) {
        const parsed = parseInboundMessage(raw);
        if (parsed) out.push(parsed);
      }
    }
  }

  return out;
}

function parseInboundMessage(raw: unknown): InboundMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const msg = raw as {
    id?: string;
    from?: string;
    type?: string;
    text?: { body?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
  };

  if (!msg.id || !msg.from) return null;

  if (msg.type === 'text') {
    return {
      messageId: msg.id,
      fromRaw: msg.from,
      type: 'text',
      textBody: msg.text?.body?.trim() ?? null,
      interactiveId: null,
    };
  }

  if (msg.type === 'interactive') {
    if (msg.interactive?.type === 'button_reply') {
      return {
        messageId: msg.id,
        fromRaw: msg.from,
        type: 'button_reply',
        textBody: msg.interactive.button_reply?.title ?? null,
        interactiveId: msg.interactive.button_reply?.id ?? null,
      };
    }
    if (msg.interactive?.type === 'list_reply') {
      return {
        messageId: msg.id,
        fromRaw: msg.from,
        type: 'list_reply',
        textBody: msg.interactive.list_reply?.title ?? null,
        interactiveId: msg.interactive.list_reply?.id ?? null,
      };
    }
  }

  return {
    messageId: msg.id,
    fromRaw: msg.from,
    type: 'other',
    textBody: null,
    interactiveId: null,
  };
}

async function handleInboundMessage(
  supabase: SupabaseClient,
  msg: InboundMessage,
): Promise<void> {
  let phoneE164: string;
  try {
    phoneE164 = normalizeIndianPhone(msg.fromRaw);
  } catch (err) {
    console.warn('Could not normalize phone', msg.fromRaw, err);
    return;
  }

  // Blue ticks — best-effort; do not block the bot.
  try {
    await markMessageAsRead(msg.messageId);
  } catch (err) {
    console.warn('markMessageAsRead failed', err);
  }

  const intent = resolveIntent(msg);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, phone_number, full_name')
    .eq('phone_number', phoneE164)
    .maybeSingle();

  if (profileError) {
    console.error('profiles lookup failed', profileError);
    await sendTextMessage(
      phoneE164,
      'Sorry — we hit a temporary issue looking up your account. Please try again in a moment.',
    );
    return;
  }

  if (!profile) {
    await sendOnboarding(phoneE164);
    return;
  }

  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, reg_number, maker_model, puc_expiry_date')
    .eq('user_id', (profile as ProfileRow).id)
    .order('reg_number', { ascending: true });

  if (vehiclesError) {
    console.error('vehicles lookup failed', vehiclesError);
    await sendTextMessage(
      phoneE164,
      'Sorry — we could not load your vehicles right now. Please try again shortly.',
    );
    return;
  }

  const vehicleList = (vehicles ?? []) as VehicleRow[];

  if (vehicleList.length === 0) {
    await sendOnboarding(phoneE164, (profile as ProfileRow).full_name);
    return;
  }

  switch (intent) {
    case 'CHALLAN':
      await replyChallans(supabase, phoneE164, vehicleList);
      break;
    case 'PUC':
      await replyPuc(phoneE164, vehicleList);
      break;
    case 'PAY':
      await replyPay(phoneE164);
      break;
    default:
      await sendDefaultMenu(phoneE164, profile as ProfileRow, vehicleList);
      break;
  }
}

function resolveIntent(msg: InboundMessage): 'CHALLAN' | 'PUC' | 'PAY' | 'MENU' {
  const id = (msg.interactiveId ?? '').toUpperCase();
  if (id === BUTTON_CHECK_CHALLANS) return 'CHALLAN';
  if (id === BUTTON_CHECK_PUC) return 'PUC';
  if (id === BUTTON_PAY_CHALLANS) return 'PAY';

  const text = (msg.textBody ?? '').trim().toUpperCase();
  if (!text) return 'MENU';

  if (
    text === 'CHALLAN' ||
    text === 'CHALLANS' ||
    text.includes('CHECK CHALLAN') ||
    text === BUTTON_CHECK_CHALLANS
  ) {
    return 'CHALLAN';
  }

  if (
    text === 'PUC' ||
    text.includes('CHECK PUC') ||
    text === BUTTON_CHECK_PUC
  ) {
    return 'PUC';
  }

  if (text === 'PAY' || text.includes('PAY CHALLAN') || text === BUTTON_PAY_CHALLANS) {
    return 'PAY';
  }

  return 'MENU';
}

// ---------------------------------------------------------------------------
// Bot replies
// ---------------------------------------------------------------------------

async function sendOnboarding(phoneE164: string, fullName?: string | null): Promise<void> {
  const base = Deno.env.get('APP_BASE_URL')?.replace(/\/$/, '') ?? 'https://vahankavach.app';
  const addVehicleUrl = `${base}/vehicles/add`;
  const greeting = fullName ? `Hi ${fullName}!` : 'Hi!';

  await sendTextMessage(
    phoneE164,
    [
      `${greeting} Welcome to *VahanKavach* 🛡️`,
      '',
      'Your WhatsApp number is not linked to any vehicle yet.',
      `Add your vehicle here to unlock challan & PUC alerts:`,
      addVehicleUrl,
      '',
      'Once linked, reply here anytime or tap the menu buttons.',
    ].join('\n'),
  );
}

async function sendDefaultMenu(
  phoneE164: string,
  profile: ProfileRow,
  vehicles: VehicleRow[],
): Promise<void> {
  const name = profile.full_name ? ` ${profile.full_name}` : '';
  const plates = vehicles.map((v) => `• ${v.reg_number}`).join('\n');

  await sendInteractiveButtons(
    phoneE164,
    [
      `Hi${name}! Your linked vehicle(s):`,
      plates,
      '',
      'What would you like to check?',
    ].join('\n'),
    [
      { id: BUTTON_CHECK_CHALLANS, title: 'Check Challans' },
      { id: BUTTON_CHECK_PUC, title: 'Check PUC Status' },
    ],
    'VahanKavach',
    'Reply CHALLAN or PUC anytime',
  );
}

async function replyChallans(
  supabase: SupabaseClient,
  phoneE164: string,
  vehicles: VehicleRow[],
): Promise<void> {
  const vehicleIds = vehicles.map((v) => v.id);
  const regById = new Map(vehicles.map((v) => [v.id, v.reg_number]));

  const { data, error } = await supabase
    .from('challans')
    .select(
      'challan_number, amount, violation_date, violation_type, status, vehicle_id, vehicles!inner(reg_number)',
    )
    .in('vehicle_id', vehicleIds)
    .eq('status', 'UNPAID')
    .order('violation_date', { ascending: false });

  if (error) {
    console.error('challans lookup failed', error);
    await sendTextMessage(
      phoneE164,
      'Sorry — we could not fetch unpaid challans right now. Please try again shortly.',
    );
    return;
  }

  const rows = (data ?? []) as ChallanRow[];

  if (rows.length === 0) {
    await sendInteractiveButtons(
      phoneE164,
      '✅ Good news — you have *no unpaid challans* on your linked vehicles.',
      [
        { id: BUTTON_CHECK_PUC, title: 'Check PUC Status' },
        { id: BUTTON_CHECK_CHALLANS, title: 'Refresh Challans' },
      ],
      'Challan Status',
    );
    return;
  }

  const lines: string[] = [`🚨 *${rows.length} unpaid challan(s):*`, ''];
  let total = 0;

  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    total += amount;
    const reg =
      nestedRegNumber(row.vehicles) ??
      regById.get(row.vehicle_id) ??
      'UNKNOWN';
    const date = formatDate(row.violation_date);
    const violation = row.violation_type ?? 'Traffic Violation';

    lines.push(
      `• *${reg}* — ₹${formatAmount(amount)}`,
      `  ${violation} · ${date}`,
      `  #${row.challan_number}`,
      '',
    );
  }

  lines.push(`*Total due: ₹${formatAmount(total)}*`);
  lines.push('Tap below to open the payment flow.');

  await sendInteractiveButtons(
    phoneE164,
    lines.join('\n').slice(0, 1024),
    [
      { id: BUTTON_PAY_CHALLANS, title: 'Pay Now' },
      { id: BUTTON_CHECK_PUC, title: 'Check PUC Status' },
    ],
    'Unpaid Challans',
  );
}

async function replyPuc(phoneE164: string, vehicles: VehicleRow[]): Promise<void> {
  const lines: string[] = ['*PUC Status*', ''];
  let anyExpired = false;
  let anyExpiringSoon = false;

  for (const v of vehicles) {
    const { indicator, label, daysRemaining, expired, expiringSoon } = pucStatus(
      v.puc_expiry_date,
    );
    if (expired) anyExpired = true;
    if (expiringSoon) anyExpiringSoon = true;

    const model = v.maker_model ? ` (${v.maker_model})` : '';
    lines.push(`${indicator} *${v.reg_number}*${model}`);
    lines.push(`   ${label}`);
    if (v.puc_expiry_date) {
      lines.push(`   Valid until: ${formatDate(v.puc_expiry_date)}`);
    }
    if (!expired && daysRemaining > 0) {
      lines.push(`   Days remaining: ${daysRemaining}`);
    }
    lines.push('');
  }

  if (anyExpired || anyExpiringSoon) {
    lines.push(PUC_LEGAL_WARNING);
  }

  await sendInteractiveButtons(
    phoneE164,
    lines.join('\n').slice(0, 1024),
    [
      { id: BUTTON_CHECK_CHALLANS, title: 'Check Challans' },
      { id: BUTTON_CHECK_PUC, title: 'Refresh PUC' },
    ],
    'PUC Compliance',
  );
}

async function replyPay(phoneE164: string): Promise<void> {
  const payUrl =
    Deno.env.get('PAYMENT_PORTAL_URL')?.trim() ||
    `${(Deno.env.get('APP_BASE_URL') ?? 'https://vahankavach.app').replace(/\/$/, '')}/challans/pay`;

  await sendTextMessage(
    phoneE164,
    [
      '💳 *Pay unpaid challans*',
      '',
      'Complete payment securely here:',
      payUrl,
      '',
      'After paying on the official portal, reply *CHALLAN* to refresh status.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function nestedRegNumber(
  vehicles: ChallanRow['vehicles'],
): string | null {
  if (!vehicles) return null;
  if (Array.isArray(vehicles)) {
    return vehicles[0]?.reg_number ?? null;
  }
  return vehicles.reg_number ?? null;
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function pucStatus(pucExpiryDate: string | null): {
  indicator: string;
  label: string;
  daysRemaining: number;
  expired: boolean;
  expiringSoon: boolean;
} {
  if (!pucExpiryDate) {
    return {
      indicator: '🔴',
      label: 'PUC date unknown — treat as non-compliant',
      daysRemaining: 0,
      expired: true,
      expiringSoon: false,
    };
  }

  const now = new Date();
  const expiry = new Date(`${pucExpiryDate}T23:59:59.999+05:30`);
  const daysRemaining = Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysRemaining <= 0) {
    return {
      indicator: '🔴',
      label: `EXPIRED (${Math.abs(daysRemaining)} day(s) overdue)`,
      daysRemaining: 0,
      expired: true,
      expiringSoon: false,
    };
  }

  if (daysRemaining <= 30) {
    return {
      indicator: '🟡',
      label: `Expiring soon — renew within ${daysRemaining} day(s)`,
      daysRemaining,
      expired: false,
      expiringSoon: true,
    };
  }

  return {
    indicator: '🟢',
    label: 'Valid',
    daysRemaining,
    expired: false,
    expiringSoon: false,
  };
}
