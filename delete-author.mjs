#!/usr/bin/env node
/**
 * delete-author.mjs — take an author out of everything the dashboard controls.
 *
 *   node delete-author.mjs --code 1004                  # dry run: what would go
 *   node delete-author.mjs --code 1004 --write          # do it
 *   node delete-author.mjs --code 1004 --undo           # dry run of an undo (within 30 days)
 *   node delete-author.mjs --code 1004 --undo --write   # put the author back
 *
 * WHAT IT REMOVES (and only this)
 *   - the coaches.json entry (backed up first, seed-validated, restored on refusal)
 *   - the Worker's KV entry  coach:<code>
 *   - the Worker secret      VF_KEY_<code>
 *   - the author's sign-offs and test results (onboarding-state.local.json) — kept in the
 *     delete record for an undo, but removed, so a number given out again starts clean
 * The dashboard's own files (readings, page settings, drafts) are cleaned by the dashboard.
 *
 * WHAT IT NEVER TOUCHES — GHL, Shopify, Zipify, Voiceflow. Decided 2026-11-02: leave them
 * alone. They are written to deleted-authors.local.json as leftovers; the dashboard lists
 * them, checks them live, and asks for a sign-off on what no API can read.
 *
 * Subscribers: a paying subscriber of this coach loses it at the next reconcile
 * (npm run subs:sync does it now). The Worker refuses a reconcile that would revoke a
 * majority of subscribers in one run unless forced — it only warns here, it never blocks.
 *
 * Safe to re-run: if the registry entry is already gone but the Worker cleanup did not
 * finish, `--write` finishes only the Worker cleanup.
 * Plan: BookCoach Author Dashboard/plans/05-edit-delete-authors.md.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { loadConfig, HERE } from './lib-config.mjs';
import { saveRegistry, STATE_FILE } from './lib-registry.mjs';
import { readDeleted, writeDeleted, recordDelete, canUndo, DELETED_FILE } from './lib-deleted.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const WRITE = has('--write');
const UNDO = has('--undo');
const code = valOf('--code');
const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};
const IS_WIN = process.platform === 'win32';
const wrangler = (args, input) => execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
  cwd: HERE, encoding: 'utf8', stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], shell: IS_WIN, ...(input ? { input } : {}),
});
const kv = ['--binding=COACH_KV', '--remote', '--preview=false'];

if (!/^\d{4}$/.test(code || '')) die('give --code <four digits>');

const state = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {});

/** Delete the Worker's KV entry and secret. Each step is its own line so a failure says which. */
function cleanWorker(c) {
  const kvKey = `coach:${String(c).toUpperCase()}`;
  const secret = `VF_KEY_${c}`;
  const failures = [];
  let exists = false;
  try { exists = !!JSON.parse(wrangler(['kv', 'key', 'get', kvKey, ...kv])); } catch { exists = false; }
  if (!exists) console.log(`  · KV ${kvKey}  already gone`);
  else {
    try { wrangler(['kv', 'key', 'delete', kvKey, ...kv]); console.log(`  ✓ KV ${kvKey}  deleted`); } catch (err) { failures.push(`KV ${kvKey}: ${String(err.stderr || err.message).split('\n')[0]}`); }
  }
  try { wrangler(['secret', 'delete', secret], 'y\n'); console.log(`  ✓ secret ${secret}  deleted`); } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message);
    // A secret that was never set (an author never taken live) is a fine result.
    if (/not found|doesn't exist|does not exist|10053|10054/i.test(msg)) console.log(`  · secret ${secret}  was not set`);
    else failures.push(`secret ${secret}: ${msg.split('\n').find((l) => l.trim()) || 'failed'}`);
  }
  return failures;
}

/* ------------------------------------------------------------------- undo --- */

if (UNDO) {
  const data = readDeleted();
  const rec = data.authors[code];
  if (!rec) die(`REFUSING — no delete record for ${code}.`);
  if (!canUndo(rec)) die(`REFUSING — ${code} cannot be undone: ${rec.finishedAt ? 'its clean-up is already finished' : 'the 30 days are over (the snapshot is gone)'}.`);
  const { coaches } = loadConfig();
  const problems = [];
  const holder = coaches.find((c) => c.code === code);
  if (holder) problems.push(`${code} now belongs to ${holder.displayName || holder.name} — give that author another number first`);
  for (const old of rec.usedCodes.filter((x) => x !== code)) {
    const h = coaches.find((c) => c.code === old || (c.formerCodes || []).map(String).includes(old));
    if (h) problems.push(`${old} (a former number of ${rec.name}) now leads to ${h.displayName || h.name}`);
  }
  console.log(`\nUndo delete of ${code} ${rec.name}${WRITE ? '' : '   (DRY RUN — nothing written)'}\n`);
  const gone = rec.items.filter((i) => i.state === 'gone' || i.state === 'signed');
  console.log(`  puts back: the registry entry, then (next steps) the Worker entry and secret`);
  if (gone.length) console.log(`  cannot come back: ${gone.map((i) => i.name).join('; ')} — already removed by hand`);
  if (problems.length) die(`REFUSING — nothing written:\n  x ${problems.join('\n  x ')}`);
  if (!WRITE) { console.log('\nDry run only. Re-run with --write.\n'); process.exit(0); }
  const { backup } = saveRegistry((doc) => { doc.coaches.push(rec.snapshot); }, { label: `undo-delete-${code}`, code });
  if (rec.stateBackup) {
    const s = state();
    if (!s[code]) { s[code] = rec.stateBackup; writeFileSync(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`, 'utf8'); }
  }
  delete data.authors[code];
  writeDeleted(data);
  console.log(`\n  coaches.json restored   (backup: ${backup})\n  Next: npm run push, then npm run subs:sync\n`);
  process.exit(0);
}

/* ----------------------------------------------------------------- delete --- */

const { coaches } = loadConfig();
const coach = coaches.find((c) => c.code === code);
const rec0 = readDeleted().authors[code];

if (!coach) {
  // Resume: the entry is gone but the Worker cleanup did not finish.
  if (rec0 && !rec0.workerCleaned && rec0.snapshot) {
    console.log(`\n${code} ${rec0.name} is already out of coaches.json. Finishing the Worker cleanup${WRITE ? '' : '   (DRY RUN)'}\n`);
    if (!WRITE) { console.log('Dry run only. Re-run with --write.\n'); process.exit(0); }
    const failures = cleanWorker(code);
    if (failures.length) die(`STOPPED — still not clean:\n  x ${failures.join('\n  x ')}\nRun this again.`);
    const data = readDeleted();
    data.authors[code].workerCleaned = true;
    writeDeleted(data);
    console.log('\n  Worker cleanup finished.\n');
    process.exit(0);
  }
  die(`REFUSING — ${code} is not in coaches.json.`);
}

const name = coach.displayName || coach.name;
const former = Array.isArray(coach.formerCodes) ? coach.formerCodes : [];
console.log(`\nDelete author ${code} ${name}${WRITE ? '' : '   (DRY RUN — nothing written)'}\n`);
console.log('  removes:');
console.log(`    coaches.json entry        (backup first; kept 30 days in ${DELETED_FILE.split(/[\\/]/).pop()} for an undo)`);
console.log(`    Worker KV                 coach:${code}`);
console.log(`    Worker secret             VF_KEY_${code}`);
console.log('    sign-offs and test results (kept in the delete record for an undo)');
console.log('  leaves alone, and lists as leftovers:');
console.log('    Shopify product(s), GHL tag / product / workflow / course / pages, Zipify pages, the Voiceflow project');
if (former.length) console.log(`  its former numbers (${former.join(', ')}) become "used before" numbers`);
console.log('  paying subscribers of this coach lose it at the next reconcile (npm run subs:sync does it now).');
if (!WRITE) {
  console.log('\nDry run only. Re-run with --write.\n');
  process.exit(0);
}

let rec;
let removedRaw;
try {
  const { backup } = saveRegistry((doc) => {
    removedRaw = doc.coaches.find((c) => String(c.code) === code);
    if (!removedRaw) throw new Error(`${code} is not in coaches.json`);
    // The record (with the snapshot) is written before anything is removed.
    rec = recordDelete(removedRaw);
    doc.coaches = doc.coaches.filter((c) => String(c.code) !== code);
  }, { label: `delete-${code}`, code });
  console.log(`\n  coaches.json: ${code} removed   (backup: ${backup})`);
} catch (err) {
  // The author is still there: a record of a delete that did not happen must not stay.
  const data = readDeleted();
  if (data.authors[code] && !data.authors[code].workerCleaned) { delete data.authors[code]; writeDeleted(data); }
  die(`STOPPED — nothing was deleted: ${err.message}`);
}

if (existsSync(STATE_FILE)) {
  const s = state();
  if (s[code]) {
    copyFileSync(STATE_FILE, `${STATE_FILE}.bak-delete`);
    const data = readDeleted();
    data.authors[code].stateBackup = s[code];
    writeDeleted(data);
    delete s[code];
    writeFileSync(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
    console.log('  onboarding-state.local.json: sign-offs and test results set aside');
  }
}

console.log('  Worker:');
const failures = cleanWorker(code);
if (failures.length) {
  die(`STOPPED — coaches.json is clean, the Worker is not:\n  x ${failures.join('\n  x ')}\nRun the same command again: it finishes only the Worker cleanup.`);
}
{
  const data = readDeleted();
  data.authors[code].workerCleaned = true;
  writeDeleted(data);
}
console.log(`
Done. Next, in this order:
  1. npm run subs:sync        subscribers of this coach lose it now, not in 15 minutes
  2. the dashboard lists what is left in GHL, Shopify and Zipify, with how to remove each
`);
