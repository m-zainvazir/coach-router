/**
 * lib-deleted.mjs — what is left after an author is deleted, and how to tell it is gone.
 *
 * Deleting an author removes only what the dashboard controls: the registry entry,
 * the Worker's KV entry and secret, the dashboard's own files. Everything in GHL,
 * Shopify and Zipify is LEFT ALONE (decided 2026-11-02) and listed here as a
 * leftover to remove by hand. Each leftover is one of:
 *
 *   todo    still there (a live check found it), or cannot be checked yet
 *   gone    a live check found it removed
 *   signed  a person confirmed it — only for a leftover no API can read
 *
 * A live check never trusts an earlier answer: a "gone" item that comes back reads
 * todo again (plan 22's rule: state is read, never remembered). A sign-off is only
 * for items the dashboard cannot see, so it can never hide something a check finds.
 *
 * The record lives in deleted-authors.local.json (gitignored). It holds a snapshot
 * of the removed registry entry so a delete can be undone for 30 days — that
 * snapshot holds the Voiceflow key, so it is NEVER returned by publicView().
 * Plan: BookCoach Author Dashboard/plans/05-edit-delete-authors.md.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { HERE } from './lib-config.mjs';
import { COURSES_VERSION } from './lib-course360.mjs';

export const DELETED_FILE = `${HERE}/deleted-authors.local.json`;
export const UNDO_DAYS = 30;
const DAY = 24 * 3600 * 1000;

export const readDeleted = (file = DELETED_FILE) => {
  try {
    const d = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    return d && d.v === 1 && d.authors && typeof d.authors === 'object' ? d : { v: 1, authors: {} };
  } catch {
    return { v: 1, authors: {} };
  }
};

export function writeDeleted(data, file = DELETED_FILE) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

const who = (c) => c.displayName || c.name || c.code;

/**
 * The leftovers of one removed registry entry, from the ids it held. `auto` items
 * have a live check; the rest wait for a person. Every item carries its own "how".
 */
export function leftoverItems(c) {
  const items = [];
  const add = (it) => items.push({ state: 'todo', at: null, note: '', ...it });
  if (c.shopifyProductId) {
    add({ id: 'shop', sys: 'Shopify', name: 'Bundle product', sub: `product ${c.shopifyProductId}${c.bookTitle ? ` · ${c.bookTitle}` : ''}`, auto: true,
      how: ['Shopify admin → Products', `Open product ${c.shopifyProductId} (search the book title)`, 'Status → Archived (or ⋯ → Delete). Past orders keep their record either way', 'Press Check again here'] });
  }
  if (c.collectionProductId) {
    add({ id: 'coll', sys: 'Shopify', name: 'Course collection bundle', sub: `product ${c.collectionProductId}`, auto: true,
      how: ['Shopify admin → Products', `Open product ${c.collectionProductId} (it ends "- Collection Bundle")`, 'Status → Archived (or ⋯ → Delete)', 'Press Check again here'] });
  }
  if (c.ghlTag) {
    add({ id: 'tag', sys: 'GHL', name: 'Coach tag', sub: c.ghlTag, auto: true,
      how: ['GHL → Settings → Tags', `Find ${c.ghlTag}`, 'Delete it. Contacts that hold it only lose the label, nothing else', 'Press Check again here'] });
  }
  if (c.ghlProductId) {
    add({ id: 'ghlprod', sys: 'GHL', name: 'The $59 product and price', sub: `product ${c.ghlProductId}`, auto: true,
      how: ['GHL → Payments → Products', `Open product ${c.ghlProductId}`, 'Delete it (cancel any live subscriptions to it first)', 'Press Check again here'] });
  }
  add({ id: 'workflow', sys: 'GHL', name: 'Grant workflow (older authors only)', sub: `"Book Coach — Grant Course (${who(c)})"`, auto: true,
    how: ['GHL → Automation → Workflows', `Search "${who(c)}"`, '⋯ → Delete (unpublish first if it asks). If there is none, press Check again: it reads as gone'] });
  if (c.courseId) {
    add({ id: 'course', sys: 'GHL', name: 'Course360 course and its Free Offer', sub: `course ${c.courseId}${c.courseOfferId ? ` · offer ${c.courseOfferId}` : ''}`, auto: true,
      how: ['GHL → Memberships → Courses', 'Open this author\'s course → ⋮ → Delete', 'Offers → delete the Free Offer that gave it', 'Press Check again here'] });
  }
  add({ id: 'page', sys: 'GHL', name: 'Coach page', sub: c.slug ? `book-coach.ai/${c.slug}` : 'the page with the pasted code', auto: false,
    how: ['GHL → Sites → Websites (or Funnels)', 'Open this author\'s coach page → delete or unpublish it', 'The dashboard cannot see this, so sign it off here'] });
  if (c.landingPageUrl) {
    add({ id: 'funnel', sys: 'GHL', name: 'The $59 funnel page', sub: c.landingPageUrl, auto: false,
      how: ['GHL → Sites → Funnels', 'Delete or unpublish this author\'s $59 funnel', 'The dashboard cannot see this, so sign it off here'] });
  }
  add({ id: 'zipify', sys: 'Zipify', name: 'Sales page and collection page', sub: c.bookLandingUrl || 'pages built in the Zipify steps', auto: false,
    how: ['Shopify admin → Apps → Zipify Pages', 'Delete this author\'s sales page and course collection page', 'The dashboard cannot see this, so sign it off here'] });
  if (c.projectID) {
    add({ id: 'vf', sys: 'Voiceflow', name: 'Coach project', sub: `project ${c.projectID}`, auto: false,
      how: ['Voiceflow → this author\'s project', 'Archive or delete it (keep it if you want the coach for your records, then just sign off)', 'The dashboard cannot see this, so sign it off here'] });
  }
  return items;
}

/** Every number the deleted author ever answered to. A new author may reuse one, with a warning. */
export const usedCodesOf = (c) => [...new Set([String(c.code), ...(Array.isArray(c.formerCodes) ? c.formerCodes.map(String) : [])])];

/** The record written when an author is deleted. `coach` is the removed registry entry. */
export function buildRecord(coach, { now = new Date(), choices = {} } = {}) {
  return {
    code: String(coach.code),
    name: who(coach),
    book: coach.bookTitle || '',
    deletedAt: now.toISOString(),
    usedCodes: usedCodesOf(coach),
    choices,
    items: leftoverItems(coach),
    snapshot: coach,
    finishedAt: null,
  };
}

export function recordDelete(coach, { now = new Date(), choices = {}, file = DELETED_FILE } = {}) {
  const data = readDeleted(file);
  const rec = buildRecord(coach, { now, choices });
  data.authors[rec.code] = rec;
  writeDeleted(data, file);
  return rec;
}

/** Number is free, or: who had it. → { code, name, deletedAt, open } | null */
export function usedBefore(code, { file = DELETED_FILE, data = readDeleted(file) } = {}) {
  const c = String(code);
  for (const rec of Object.values(data.authors)) {
    if ((rec.usedCodes || [rec.code]).map(String).includes(c)) {
      return { code: c, name: rec.name, deletedAt: rec.deletedAt, open: !rec.finishedAt, was: rec.code };
    }
  }
  return null;
}

/** The warning shown before a number that belonged to a deleted author is given out again. */
export function reuseWarning(code, opts) {
  const u = usedBefore(code, opts);
  if (!u) return null;
  const when = new Date(u.deletedAt).toISOString().slice(0, 10);
  return `${code} belonged to ${u.name} (deleted ${when}${u.open ? ', clean-up still open' : ''}). Old sessions, trial records and contacts may still carry ${code} and could show the new coach to the wrong people. Continue?`;
}

/** Undo while the clean-up row is still open and inside the 30 days. */
export const canUndo = (rec, now = new Date()) => !!rec.snapshot && !rec.finishedAt && now - new Date(rec.deletedAt) <= UNDO_DAYS * DAY;

export const remaining = (rec) => rec.items.filter((i) => i.state === 'todo').length;
export const isFinished = (rec) => rec.items.every((i) => i.state !== 'todo');

/**
 * Apply live-check results: [{ id, present: true | false | null, note? }].
 * present false → gone; true → todo (it came back, or is still there); null → unchanged
 * (the check could not tell, e.g. a missing GHL scope — never read as "gone").
 */
export function applyChecks(rec, results, now = new Date()) {
  for (const r of results) {
    const it = rec.items.find((i) => i.id === r.id);
    if (!it || !it.auto) continue; // a sign-off item is never decided by a check
    if (r.note !== undefined) it.note = r.note;
    if (r.present === false && it.state !== 'gone') { it.state = 'gone'; it.at = now.toISOString(); }
    else if (r.present === true && it.state !== 'todo') { it.state = 'todo'; it.at = null; }
  }
  // Finished when nothing is left; a thing that comes back reopens it (like a sign-off taken back).
  rec.finishedAt = isFinished(rec) ? (rec.finishedAt || now.toISOString()) : null;
  return rec;
}

/** Sign off (or, with `value` false, take back) a leftover no API can read. → [ok, problem] */
export function signOff(rec, id, { note = '', value = true, now = new Date() } = {}) {
  const it = rec.items.find((i) => i.id === id);
  if (!it) return [false, `no such item "${id}"`];
  if (it.auto) return [false, `${it.name} is checked live — remove it, then press Check again. A sign-off cannot stand in for a check`];
  if (value) { it.state = 'signed'; it.at = now.toISOString(); it.note = String(note || '').slice(0, 300); }
  else { it.state = 'todo'; it.at = null; it.note = ''; }
  if (isFinished(rec)) rec.finishedAt = rec.finishedAt || now.toISOString(); else rec.finishedAt = null;
  return [true, null];
}

const SECRET_FIELDS = ['apiKey', 'vfKey'];
const stripSecrets = (snap) => Object.fromEntries(Object.entries(snap || {}).filter(([k]) => !SECRET_FIELDS.includes(k)));

/**
 * Forget what must not be kept: after the undo window the snapshot loses its Voiceflow key
 * (the ids stay — the live checks need them); a finished record stays 30 days as "Finished",
 * then collapses to a stub — but its used numbers stay (usedCodes) so a reuse still warns.
 */
export function prune(data, now = new Date()) {
  let changed = false;
  for (const [code, rec] of Object.entries(data.authors)) {
    const age = now - new Date(rec.deletedAt);
    if (rec.snapshot && age > UNDO_DAYS * DAY && SECRET_FIELDS.some((k) => k in rec.snapshot)) { rec.snapshot = stripSecrets(rec.snapshot); rec.stateBackup = null; changed = true; }
    if (rec.finishedAt && now - new Date(rec.finishedAt) > UNDO_DAYS * DAY) {
      data.authors[code] = { code: rec.code, name: rec.name, usedCodes: rec.usedCodes, deletedAt: rec.deletedAt, finishedAt: rec.finishedAt, items: [], gone: true };
      changed = true;
    }
  }
  return changed;
}

/** What the screen may see. NEVER the snapshot. */
export function publicView(rec, now = new Date()) {
  return {
    code: rec.code, name: rec.name, book: rec.book, deletedAt: rec.deletedAt, finishedAt: rec.finishedAt || null,
    canUndo: canUndo(rec, now), undoUntil: new Date(new Date(rec.deletedAt).getTime() + UNDO_DAYS * DAY).toISOString(),
    left: remaining(rec), total: rec.items.length,
    items: rec.items.map(({ id, sys, name, sub, auto, state, at, note, how }) => ({ id, sys, name, sub, auto, state, at, note, how })),
  };
}

/** Keys held in snapshots — so the server's "no credential leaves" check covers a removed author too. */
export function snapshotSecrets(data = readDeleted()) {
  const out = [];
  for (const rec of Object.values(data.authors)) {
    const s = rec.snapshot || {};
    for (const k of ['apiKey', 'vfKey']) if (typeof s[k] === 'string' && s[k].trim().length >= 8) out.push(s[k].trim());
  }
  return out;
}

/* ------------------------------------------------------------ live checks --- */

const is = (err, code) => new RegExp(`^GHL ${code} `).test(String((err && err.message) || ''));

/**
 * Read each auto item from the live systems. `ctx` is lib-readers' (catalog, ghl, locationId) —
 * GET reads only (plus the one contacts search for the tag's holder count). A check that cannot
 * tell (no scope, an outage) answers null: it never turns an item "gone".
 * → [{ id, present, note? }]
 */
export async function checkLeftovers(rec, ctx) {
  const c = rec.snapshot || {};
  const out = [];
  const loc = encodeURIComponent(ctx.locationId || '');
  const run = async (id, fn) => {
    try { out.push({ id, ...(await fn()) }); } catch (err) {
      out.push({ id, present: null, note: `could not check: ${String(err.message || err).slice(0, 120)}` });
    }
  };
  for (const it of rec.items.filter((i) => i.auto)) {
    if (it.id === 'shop' || it.id === 'coll') {
      await run(it.id, async () => {
        const id = String(it.id === 'shop' ? c.shopifyProductId : c.collectionProductId);
        const cat = await ctx.catalog();
        // The public catalogue lists only products on sale: absent = archived, draft or deleted.
        return { present: cat.has(id), note: cat.has(id) ? 'still on sale in the shop' : 'no longer on sale' };
      });
    } else if (it.id === 'tag') {
      await run('tag', async () => {
        let tags;
        try { tags = (await ctx.ghl(`/locations/${loc}/tags`)).tags || []; } catch (err) {
          if (is(err, 401) || is(err, 403)) return { present: null, note: 'the GHL token cannot read tags (locations/tags.readonly) — check by hand and press Check again' };
          throw err;
        }
        const here = tags.some((t) => String(t.name || '').toLowerCase() === String(c.ghlTag).toLowerCase());
        if (!here) return { present: false, note: 'tag not found' };
        let held = '';
        try {
          const data = await ctx.ghl('/contacts/search', { method: 'POST', body: { locationId: ctx.locationId, pageLimit: 100, filters: [{ field: 'tags', operator: 'contains', value: [c.ghlTag] }] } });
          const n = (data.contacts || []).length;
          held = ` · held by ${n}${n === 100 ? '+' : ''} contact(s)`;
        } catch { /* the count is a nicety */ }
        return { present: true, note: `still in GHL${held}` };
      });
    } else if (it.id === 'ghlprod') {
      await run('ghlprod', async () => {
        try { await ctx.ghl(`/products/${encodeURIComponent(c.ghlProductId)}?locationId=${loc}`); return { present: true, note: 'still in GHL' }; } catch (err) {
          if (is(err, 404)) return { present: false, note: 'not found' };
          throw err;
        }
      });
    } else if (it.id === 'workflow') {
      await run('workflow', async () => {
        let list;
        try { list = (await ctx.ghl(`/workflows/?locationId=${loc}`)).workflows || []; } catch (err) {
          if (is(err, 401) || is(err, 403)) return { present: null, note: 'the GHL token cannot read workflows — check by hand' };
          throw err;
        }
        const names = [c.displayName, c.name].filter(Boolean).map((n) => n.toLowerCase());
        const hits = list.filter((w) => /^book coach\s*[—-]+\s*grant course\s*\(/i.test(w.name || '') && names.some((n) => String(w.name).toLowerCase().includes(`(${n})`)));
        return { present: hits.length > 0, note: hits.length ? `still there: ${hits.map((w) => `${w.name} [${w.status}]`).join(', ')}` : 'none found' };
      });
    } else if (it.id === 'course') {
      await run('course', async () => {
        try { await ctx.ghl(`/courses/products/${encodeURIComponent(c.courseId)}?locationId=${loc}`, { version: COURSES_VERSION }); return { present: true, note: 'still in Course360' }; } catch (err) {
          if (is(err, 404)) return { present: false, note: 'not found' };
          if (is(err, 401) || is(err, 403)) return { present: null, note: 'the GHL token cannot read courses — check by hand' };
          throw err;
        }
      });
    }
  }
  return out;
}
