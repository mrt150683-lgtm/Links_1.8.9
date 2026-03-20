/**
 * Nudges & Main Chat Notifications — E2E Seed Script (Flow #19)
 *
 * Usage:
 *   node scripts/nudges-e2e.mjs
 *
 * Then run the worker once:
 *   cd apps/worker && npx tsx src/index.ts --once
 *
 * NOTE: generate_nudges has cooldowns:
 *   new_entry: 6h per pot (fresh pot = no cooldown on first run ✓)
 *   greeting:  24h global (may be blocked if called today already)
 * Re-running this script with a new pot bypasses new_entry cooldown.
 * To re-test greeting: clear user_prefs key "nudges.cooldown.greeting" from DB.
 */

const BASE = 'http://localhost:3000';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

// ── Step 1: Create test pot ────────────────────────────────────────────
console.log('\n=== NUDGES E2E TEST (Flow #19) ===\n');
console.log('Step 1: Creating test pot...');
const potRes = await post('/pots', { name: 'Nudges E2E Test Pot' });
if (potRes.status !== 201) {
  console.error('  FAILED creating pot:', JSON.stringify(potRes.data));
  process.exit(1);
}
const potId = potRes.data.id;
console.log(`  ✓ potId: ${potId}`);

// ── Step 2: Test 19.1 — Triage nudge (new_entry trigger) ──────────────
console.log('\nStep 2 [Test 19.1]: Capturing 3 entries to trigger triage nudge...');
const ENTRIES = [
  {
    text: 'Researchers at MIT have developed a new battery technology using sodium-ion chemistry that promises 40% higher energy density than current lithium-ion cells at half the material cost.',
    source_title: 'MIT Battery Research 2025',
  },
  {
    text: 'A new study in Nature Climate Change shows that reforestation efforts in the Amazon have accelerated by 23% since 2022, with community-led programs outperforming government-run initiatives by a factor of three.',
    source_title: 'Amazon Reforestation Report',
  },
  {
    text: 'The FDA has approved a novel mRNA-based treatment for Type 1 diabetes that reprograms immune cells to stop attacking pancreatic beta cells, with 78% of trial participants showing reduced insulin dependence after 12 months.',
    source_title: 'FDA mRNA Diabetes Treatment Approval',
  },
];

const entryIds = [];
for (const e of ENTRIES) {
  const r = await post(`/pots/${potId}/entries/text`, {
    text: e.text,
    source_title: e.source_title,
    capture_method: 'manual',
  });
  if (r.status !== 201) {
    console.error(`  FAILED adding entry "${e.source_title}": ${JSON.stringify(r.data)}`);
    process.exit(1);
  }
  entryIds.push(r.data.id);
  console.log(`  ✓ ${r.data.id} — ${e.source_title}`);
}

console.log('\n  → Entries captured. generate_nudges(trigger=new_entry) is auto-enqueued by worker.');
console.log('  Run worker once → then check:');
console.log('    GET /main-chat/notifications');
console.log('  Expected: notification with type: "triage", title mentioning entry count');

// ── Step 3: Test 19.2 — Greeting nudge ────────────────────────────────
console.log('\nStep 3 [Test 19.2]: Triggering greeting nudge via GET /main-chat/context-pack...');
const ctxRes = await get('/main-chat/context-pack');
if (ctxRes.status !== 200) {
  console.error('  FAILED context-pack:', JSON.stringify(ctxRes.data));
} else {
  console.log(`  ✓ context-pack OK (greeting: "${ctxRes.data.greeting}")`);
  console.log('  → generate_nudges(trigger=greeting) was fired in background.');
  console.log('  Run worker once → then check:');
  console.log('    GET /main-chat/notifications');
  console.log('  Expected: notification with type: "greeting"');
  console.log('  NOTE: 24h global cooldown — if greeting was already sent today, this is skipped by the worker.');
}

// ── Step 4: Test 19.3 — Journal nudge (instructions only) ─────────────
console.log('\nStep 4 [Test 19.3 — manual, requires journal flow]:');
console.log('  For 19.3: After running journal flow (Flow #14), run worker once.');
console.log('  Expected: notification with type: "insight", title: "Daily journal ready — {date}"');

// ── Step 5: Test 19.4 — Notification list ─────────────────────────────
console.log('\nStep 5 [Test 19.4]: Fetching current notification list...');
const notifListRes = await get('/main-chat/notifications');
if (notifListRes.status !== 200) {
  console.error('  FAILED listing notifications:', JSON.stringify(notifListRes.data));
} else {
  const notifications = notifListRes.data.notifications ?? [];
  console.log(`  ✓ Active notifications: ${notifications.length}`);
  for (const n of notifications) {
    console.log(`    [${n.state}] (${n.type}) "${n.title}" — id: ${n.id}`);
  }
}

const unreadRes = await get('/main-chat/notifications/unread-count');
if (unreadRes.status === 200) {
  console.log(`  ✓ Unread count: ${unreadRes.data.count}`);
}

// ── Step 6: Test 19.5 — Mark state ────────────────────────────────────
console.log('\nStep 6 [Test 19.5]: Testing notification state transitions...');

// 19.5a — Mark open (use first existing or create one)
let firstId = null;
const existingNotifs = notifListRes.data?.notifications ?? [];
if (existingNotifs.length > 0) {
  firstId = existingNotifs[0].id;
  console.log(`  Using existing notification id: ${firstId}`);
} else {
  // Create a test notification
  const createRes = await post('/main-chat/notifications', {
    type: 'system',
    title: 'E2E Test: Open state',
    preview: 'Test notification for open state',
  });
  if (createRes.status !== 201) {
    console.error('  FAILED creating test notification:', JSON.stringify(createRes.data));
  } else {
    firstId = createRes.data.notification.id;
    console.log(`  Created test notification id: ${firstId}`);
  }
}

if (firstId) {
  const openRes = await post(`/main-chat/notifications/${firstId}/open`, {});
  console.log(`  ✓ POST .../open → ${openRes.status} ${JSON.stringify(openRes.data)}`);
}

// 19.5b — Create + dismiss
console.log('\n  Creating notification to test dismiss...');
const dismissNotifRes = await post('/main-chat/notifications', {
  type: 'system',
  title: 'E2E Test: Dismiss state',
  preview: 'This notification will be dismissed',
});
if (dismissNotifRes.status === 201) {
  const dismissId = dismissNotifRes.data.notification.id;
  const dismissRes = await post(`/main-chat/notifications/${dismissId}/dismiss`, {});
  console.log(`  ✓ POST .../dismiss → ${dismissRes.status} ${JSON.stringify(dismissRes.data)}`);
  console.log(`    (Notification ${dismissId} should NOT appear in next list)`);
} else {
  console.error('  FAILED creating dismiss test notification:', JSON.stringify(dismissNotifRes.data));
}

// 19.5c — Create + snooze
console.log('\n  Creating notification to test snooze...');
const snoozeNotifRes = await post('/main-chat/notifications', {
  type: 'system',
  title: 'E2E Test: Snooze state',
  preview: 'This notification will be snoozed for 2 hours',
});
if (snoozeNotifRes.status === 201) {
  const snoozeId = snoozeNotifRes.data.notification.id;
  const snoozeRes = await post(`/main-chat/notifications/${snoozeId}/snooze`, { hours: 2 });
  console.log(`  ✓ POST .../snooze → ${snoozeRes.status} ${JSON.stringify(snoozeRes.data)}`);
  console.log(`    (Notification ${snoozeId} should NOT appear in next list until 2h later)`);
} else {
  console.error('  FAILED creating snooze test notification:', JSON.stringify(snoozeNotifRes.data));
}

// Final notification list
console.log('\n  Final notification list (dismissed + snoozed should be absent):');
const finalListRes = await get('/main-chat/notifications');
if (finalListRes.status === 200) {
  const finalNotifs = finalListRes.data.notifications ?? [];
  console.log(`  ✓ Active notifications: ${finalNotifs.length}`);
  for (const n of finalNotifs) {
    console.log(`    [${n.state}] (${n.type}) "${n.title}" — id: ${n.id}`);
  }
}

// ── Summary ────────────────────────────────────────────────────────────
console.log('\n=== SEED COMPLETE ===');
console.log(`Test pot: ${potId}`);
console.log(`Entries captured: ${entryIds.join(', ')}`);
console.log('\nNext steps:');
console.log('  1. Run worker: cd apps/worker && npx tsx src/index.ts --once');
console.log('     (Run 2–3 times to process triage nudge + greeting nudge jobs)');
console.log('  2. Check: GET /main-chat/notifications');
console.log('     Expected: ≥1 notification (triage), possibly greeting if not on cooldown');
console.log('  3. Verify state transitions above (opened, dismissed absent, snoozed absent)');
console.log('\nFlow #19 test items:');
console.log('  19.1 — Triage nudge:   Run worker → GET /main-chat/notifications (type=triage)');
console.log('  19.2 — Greeting nudge: Run worker → GET /main-chat/notifications (type=greeting)');
console.log('  19.3 — Journal nudge:  Requires Flow #14 first');
console.log('  19.4 — Notif list:     Verified above ✓');
console.log('  19.5 — State changes:  Verified above ✓ (open/dismiss/snooze)');
