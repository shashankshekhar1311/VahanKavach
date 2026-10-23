/**
 * telegram-webhook — Telegram Bot API inbound handler (staging + production)
 *
 * Commands:
 *   /start <token>     — 1-click account linking via profiles.telegram_link_token
 *   /status            — fleet PUC + unpaid challan summary for the linked chat
 *   /simulate_alert    — staging: fire a test PUC alert via NotificationDispatcher
 *
 * Secrets:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_SECRET  — optional; when set, require X-Telegram-Bot-Api-Secret-Token
 *   APP_BASE_URL             — onboarding deep-link (optional)
 *   ENVIRONMENT              — staging → sandbox prefixes on outbound messages
 *
 * Auto-injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Deploy note: verify_jwt = false (Telegram cannot send a Supabase JWT).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  escapeHtml,
  formatDateInIst,
  PUC_LEGAL_WARNING_PLAIN,
} from '../_shared/notifications/types.ts';
import {
  telegramSendText,
  TelegramProviderError,
} from '../_shared/notifications/telegram.provider.ts';
import { notificationDispatcher } from '../_shared/notifications/dispatcher.ts';

/** Supabase Edge Runtime background-task API. */
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

interface TelegramChat {
  id: number | string;
  type?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: { id: number | string; first_name?: string; username?: string };
  text?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  telegram_chat_id: string | null;
  preferred_channel: string | null;
}

interface VehicleRow {
  id: string;
  reg_number: string;
  maker_model: string | null;
  puc_expiry_date: string | null;
}

function requireTelegramBotToken(): string {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }
  return token;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    try {
      requireTelegramBotToken();
      return new Response('VahanKavach Telegram webhook OK', { status: 200 });
    } catch {
      return new Response('TELEGRAM_BOT_TOKEN missing', { status: 500 });
    }
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    requireTelegramBotToken();
  } catch {
    console.error('telegram-webhook: TELEGRAM_BOT_TOKEN missing');
    return new Response('Server misconfiguration', { status: 500 });
  }

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim();
  if (expectedSecret) {
    const provided = req.headers.get('X-Telegram-Bot-Api-Secret-Token')?.trim() ?? '';
    if (provided !== expectedSecret) {
      console.warn('Rejected Telegram webhook: invalid secret token');
      return new Response('Forbidden', { status: 403 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const work = handleUpdate(update).catch((err) => {
    console.error('telegram-webhook background error', err);
  });

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || message.chat?.id === undefined) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const supabase = createServiceClient();

  if (text.startsWith('/start')) {
    const token = text.slice('/start'.length).trim();
    await handleStart(supabase, chatId, token, message.from?.first_name);
    return;
  }

  if (text === '/status' || text.startsWith('/status ')) {
    await handleStatus(supabase, chatId);
    return;
  }

  if (text === '/simulate_alert' || text.startsWith('/simulate_alert ')) {
    await handleSimulateAlert(supabase, chatId);
    return;
  }

  if (text.startsWith('/')) {
    await telegramSendText(
      chatId,
      [
        '<b>VahanKavach</b> commands:',
        '',
        '/start &lt;token&gt; — link your account (use Connect Telegram in the app)',
        '/status — fleet PUC &amp; challan summary',
        '/simulate_alert — fire a sandbox PUC test alert',
      ].join('\n'),
      undefined,
      { skipSandboxPrefix: true },
    );
  }
}

async function handleStart(
  supabase: SupabaseClient,
  chatId: string,
  token: string,
  firstName?: string,
): Promise<void> {
  if (!token) {
    const existing = await findProfileByChatId(supabase, chatId);
    if (existing) {
      await telegramSendText(
        chatId,
        [
          `✅ Already linked${existing.full_name ? `, <b>${escapeHtml(existing.full_name)}</b>` : ''}.`,
          '',
          'Send /status for your fleet compliance summary.',
          'Send /simulate_alert to test PUC delivery.',
        ].join('\n'),
        undefined,
        { skipSandboxPrefix: true },
      );
      return;
    }

    const base = (
      Deno.env.get('APP_BASE_URL')?.trim() || 'https://vahankavach.app'
    ).replace(/\/$/, '');
    await telegramSendText(
      chatId,
      [
        'Welcome to <b>VahanKavach</b> 🛡️',
        '',
        'Open the garage dashboard and tap <b>Connect Telegram</b> to get a one-click link,',
        'or send <code>/start &lt;your-token&gt;</code>.',
        '',
        `Dashboard: ${escapeHtml(base)}/dashboard`,
      ].join('\n'),
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone_number, telegram_chat_id, preferred_channel')
    .eq('telegram_link_token', token)
    .maybeSingle();

  if (error) {
    console.error('telegram link lookup failed', error);
    await telegramSendText(
      chatId,
      'Sorry — we could not verify that link right now. Please try again from the app.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const profile = data as ProfileRow | null;
  if (!profile) {
    await telegramSendText(
      chatId,
      '❌ That link token is invalid or already used. Generate a new one from Notification Preferences in the app.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const chatOwner = await findProfileByChatId(supabase, chatId);
  if (chatOwner && chatOwner.id !== profile.id) {
    await telegramSendText(
      chatId,
      'This Telegram account is already linked to another VahanKavach profile. Unlink it first from the other account.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      telegram_chat_id: chatId,
      telegram_link_token: null,
      preferred_channel: 'TELEGRAM',
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id);

  if (updateError) {
    console.error('telegram link update failed', updateError);
    await telegramSendText(
      chatId,
      'Linking failed due to a server error. Please try again shortly.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const name =
    profile.full_name?.trim() ||
    firstName?.trim() ||
    'there';

  await telegramSendText(
    chatId,
    [
      `✅ Linked, <b>${escapeHtml(name)}</b>!`,
      '',
      'You will receive PUC &amp; compliance alerts here on Telegram.',
      'Send /status anytime for your fleet summary.',
      'Send /simulate_alert to fire a sandbox test alert.',
    ].join('\n'),
    undefined,
    { skipSandboxPrefix: true },
  );
}

async function handleStatus(
  supabase: SupabaseClient,
  chatId: string,
): Promise<void> {
  const profile = await findProfileByChatId(supabase, chatId);
  if (!profile) {
    await telegramSendText(
      chatId,
      [
        'Your Telegram is not linked yet.',
        'Open the VahanKavach dashboard → Notification Preferences → Connect Telegram.',
      ].join('\n'),
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const { data: vehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, reg_number, maker_model, puc_expiry_date')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: true });

  if (vehicleError) {
    console.error('telegram status vehicles failed', vehicleError);
    await telegramSendText(
      chatId,
      'Could not load your fleet right now. Try again shortly.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const list = (vehicles ?? []) as VehicleRow[];
  if (list.length === 0) {
    const base = (
      Deno.env.get('APP_BASE_URL')?.trim() || 'https://vahankavach.app'
    ).replace(/\/$/, '');
    await telegramSendText(
      chatId,
      [
        `Hi <b>${escapeHtml(profile.full_name ?? 'there')}</b> — no vehicles linked yet.`,
        '',
        `Add one here: ${escapeHtml(base)}/dashboard`,
        'Tip: use Load Test Vehicle → KA02CD5678 in the sandbox app.',
      ].join('\n'),
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const vehicleIds = list.map((v) => v.id);
  const { data: challanRows, error: challanError } = await supabase
    .from('challans')
    .select('vehicle_id, amount, status')
    .in('vehicle_id', vehicleIds)
    .eq('status', 'UNPAID');

  if (challanError) {
    console.error('telegram status challans failed', challanError);
  }

  const unpaidByVehicle = new Map<string, { count: number; total: number }>();
  for (const row of challanRows ?? []) {
    const r = row as { vehicle_id: string; amount: number | string };
    const prev = unpaidByVehicle.get(r.vehicle_id) ?? { count: 0, total: 0 };
    prev.count += 1;
    prev.total += Number(r.amount) || 0;
    unpaidByVehicle.set(r.vehicle_id, prev);
  }

  const lines: string[] = [
    `<b>Fleet status</b>${profile.full_name ? ` — ${escapeHtml(profile.full_name)}` : ''}`,
    '',
  ];
  let anyPucIssue = false;

  for (const v of list) {
    const puc = describePuc(v.puc_expiry_date);
    if (puc.issue) anyPucIssue = true;
    const model = v.maker_model ? ` (${escapeHtml(v.maker_model)})` : '';
    const unpaid = unpaidByVehicle.get(v.id);
    const challanLine = unpaid
      ? `🚨 ${unpaid.count} unpaid · ₹${formatAmount(unpaid.total)}`
      : '✅ No unpaid challans';

    lines.push(`${puc.indicator} <b>${escapeHtml(v.reg_number)}</b>${model}`);
    lines.push(`   PUC: ${escapeHtml(puc.label)}`);
    if (v.puc_expiry_date) {
      lines.push(`   Valid until: ${escapeHtml(formatDateInIst(v.puc_expiry_date))}`);
    }
    lines.push(`   ${challanLine}`);
    lines.push('');
  }

  if (anyPucIssue) {
    lines.push(`⚠️ ${escapeHtml(PUC_LEGAL_WARNING_PLAIN)}`);
  }

  try {
    await telegramSendText(chatId, lines.join('\n').slice(0, 4000), undefined, {
      skipSandboxPrefix: true,
    });
  } catch (err) {
    if (err instanceof TelegramProviderError) {
      console.error('telegram /status send failed', err.status, err.details);
    }
    throw err;
  }
}

/**
 * Interactive staging command: dispatch a real NotificationDispatcher PUC alert
 * for the caller's first vehicle (or a synthetic 7-day warning if none exist).
 */
async function handleSimulateAlert(
  supabase: SupabaseClient,
  chatId: string,
): Promise<void> {
  const profile = await findProfileByChatId(supabase, chatId);
  if (!profile) {
    await telegramSendText(
      chatId,
      'Link your account with /start &lt;token&gt; before simulating alerts.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, reg_number, maker_model, puc_expiry_date')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('simulate_alert vehicles failed', error);
    await telegramSendText(
      chatId,
      'Could not load vehicles for simulate_alert.',
      undefined,
      { skipSandboxPrefix: true },
    );
    return;
  }

  const vehicle = (vehicles?.[0] as VehicleRow | undefined) ?? null;
  const regNumber = vehicle?.reg_number ?? 'KA02CD5678';
  const makerModel = vehicle?.maker_model ?? 'Sandbox Test Vehicle';
  const pucExpiry = vehicle?.puc_expiry_date ?? null;
  const daysLeft = pucExpiry
    ? Math.max(
        0,
        Math.ceil(
          (new Date(`${pucExpiry}T23:59:59.999Z`).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : 7;

  try {
    const result = await notificationDispatcher.dispatch({
      userId: profile.id,
      ownerName: profile.full_name,
      preferredChannel: 'TELEGRAM',
      phoneNumber: profile.phone_number,
      telegramChatId: chatId,
      signalNumber: null,
      regNumber,
      makerModel,
      pucExpiryDate: pucExpiry,
      daysLeft: daysLeft === 0 ? 0 : Math.min(daysLeft, 7) || 7,
      alertLabel: 'PUC',
    });

    await telegramSendText(
      chatId,
      [
        '✅ <b>simulate_alert</b> dispatched.',
        `Channel: ${escapeHtml(result.channel)}`,
        `Urgency: ${escapeHtml(result.urgency)}`,
        `Message id: ${escapeHtml(result.messageId ?? 'n/a')}`,
        `Vehicle: <b>${escapeHtml(regNumber)}</b>`,
      ].join('\n'),
      undefined,
      { skipSandboxPrefix: true },
    );
  } catch (err) {
    console.error('simulate_alert dispatch failed', err);
    await telegramSendText(
      chatId,
      `❌ simulate_alert failed: ${escapeHtml(
        err instanceof Error ? err.message : String(err),
      )}`,
      undefined,
      { skipSandboxPrefix: true },
    );
  }
}

async function findProfileByChatId(
  supabase: SupabaseClient,
  chatId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone_number, telegram_chat_id, preferred_channel')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (error) {
    console.error('findProfileByChatId failed', error);
    return null;
  }
  return (data as ProfileRow | null) ?? null;
}

function describePuc(pucExpiryDate: string | null): {
  indicator: string;
  label: string;
  issue: boolean;
} {
  if (!pucExpiryDate) {
    return { indicator: '⚪', label: 'Unknown', issue: true };
  }
  const end = new Date(`${pucExpiryDate}T23:59:59.999Z`).getTime();
  const days = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) {
    return { indicator: '🔴', label: 'Expired', issue: true };
  }
  if (days <= 7) {
    return {
      indicator: '🟠',
      label: `Expiring in ${days} day${days === 1 ? '' : 's'}`,
      issue: true,
    };
  }
  return {
    indicator: '🟢',
    label: `${days} days remaining`,
    issue: false,
  };
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

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
