// The bus-factor model, after Avelino, Passos, Hora and Valente,
// "A Novel Approach for Estimating Truck Factors" (ICPC 2016).
//
// A person is an author of a file when their degree of authorship (DOA) is at
// least 3.293 and more than 75% of the file's highest DOA. The project is in
// trouble once its authors cover less than half of the files. The bus factor
// is how many top authors must go for that to happen.

import { isCode, isThirdParty } from "./filter.js";

export const DOA_MIN = 3.293;
export const DOA_SHARE = 0.75;
export const COVERAGE = 0.5;
const MONTH = 30.44 * 86400;

export function doa(firstAuthor, deliveries, others) {
  return 3.293 + 1.098 * (firstAuthor ? 1 : 0) + 0.164 * deliveries - 0.321 * Math.log(1 + others);
}

const BOT_NAME = /\[bot\]$|^dependabot|^renovate|^github-actions|^greenkeeper|^snyk-bot|^imgbot|^allcontributors|^semantic-release-bot|^mergify|^codecov|^pre-commit-ci|^k8s-ci-robot|[-_ ]bot$/i;
const BOT_MAIL = /\[bot\]@|^bot@|^noreply@github\.com$/i;

export function isBot({ name, email }) {
  return BOT_NAME.test(name.trim()) || BOT_MAIL.test(email.trim());
}

const GENERIC_NAMES = new Set(["root", "admin", "administrator", "unknown", "user", "ubuntu", "yourname", "git", "github", "none", "test", "dev", "developer"]);
const GENERIC_MAIL = /^(none|noreply|no-reply|root|you|your\.?email|test|user|admin)@|@(localhost|example\.(com|org)|\(none\))|^$/i;

/** Lowercase, without accents, spaces or punctuation: "Ulises Gascón" = "ulises gascon". */
const normalize = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Keys that identify one person across their git identities. */
export function aliasKeys({ name, email }) {
  const keys = [];
  const mail = email.trim().toLowerCase();
  if (!GENERIC_MAIL.test(mail)) keys.push(`mail:${mail}`);
  const handle = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(mail);
  if (handle) keys.push(`name:${normalize(handle[1])}`);
  const norm = normalize(name);
  if (norm.length >= 3 && !GENERIC_NAMES.has(norm)) keys.push(`name:${norm}`);
  return keys;
}

/** Merge raw git identities into people. Returns { people, personOf }. */
export function mergeIdentities(identities) {
  const list = [...identities].filter((i) => !isBot(i));
  const parent = new Map(list.map((i) => [i.id, i.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const seen = new Map();
  for (const i of list) {
    for (const k of aliasKeys(i)) {
      if (seen.has(k)) parent.set(find(i.id), find(seen.get(k)));
      else seen.set(k, i.id);
    }
  }
  const groups = new Map();
  for (const i of list) {
    const root = find(i.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const people = [];
  const personOf = new Map();
  for (const group of groups.values()) {
    const best = group.reduce((a, b) => (b.commits > a.commits ? b : a));
    const p = {
      index: people.length,
      name: best.name,
      email: best.email,
      commits: group.reduce((n, i) => n + i.commits, 0),
      last: Math.max(...group.map((i) => i.last)),
      files: 0,
    };
    people.push(p);
    for (const i of group) personOf.set(i.id, p.index);
  }
  return { people, personOf };
}

/** The authors of one file, given its creator and change counts per person. */
export function authorsOf(creator, counts) {
  let total = 0;
  for (const n of counts.values()) total += n;
  const scores = [...counts].map(([p, n]) => [p, doa(p === creator, n, total - n)]);
  const top = Math.max(...scores.map(([, d]) => d));
  if (!(top > 0)) return [];
  return scores.filter(([, d]) => d >= DOA_MIN && d / top > DOA_SHARE).map(([p]) => p);
}

/** Turn a ledger and the files at HEAD into the model everything else reads. */
export function buildModel(ledger, headPaths, opts = {}) {
  const { now = Date.now() / 1000, goneMonths = 12, allFiles = false, path = "" } = opts;
  const prefix = path.replace(/^\.\//, "").replace(/\/*$/, "");
  const inScope = (p) => !prefix || p === prefix || p.startsWith(`${prefix}/`);
  const { people, personOf } = mergeIdentities(ledger.identities.values());
  const entries = [];
  for (const p of headPaths) {
    if (!inScope(p)) continue;
    if (allFiles ? isThirdParty(p) : !isCode(p)) continue;
    const f = ledger.files.get(p);
    if (!f || f.binary) continue;
    const counts = new Map();
    for (const [id, n] of f.counts) {
      const who = personOf.get(id);
      if (who !== undefined) counts.set(who, (counts.get(who) || 0) + n);
    }
    if (!counts.size) continue;
    const authors = authorsOf(personOf.get(f.creator), counts);
    for (const a of authors) people[a].files++;
    entries.push({ path: p, authors, counts });
  }
  const cutoff = now - goneMonths * MONTH;
  for (const p of people) p.gone = p.last < cutoff;
  return { entries, people, commits: ledger.commits, goneMonths, now };
}

/**
 * Remove the top authors one at a time. `removed` starts out gone.
 * `busFactor` is how many must leave before coverage falls below half, and
 * `curve[k]` is the share of files nobody knows after k people have left.
 */
export function greedy(entries, people, removed = new Set(), maxSteps = 15) {
  const n = entries.length;
  const left = entries.map((e) => e.authors.filter((a) => !removed.has(a)).length);
  const filesOf = new Map();
  const own = new Map();
  entries.forEach((e, i) => {
    for (const a of e.authors) {
      if (removed.has(a)) continue;
      own.set(a, (own.get(a) || 0) + 1);
      if (!filesOf.has(a)) filesOf.set(a, []);
      filesOf.get(a).push(i);
    }
  });
  const order = [...own.keys()].sort((a, b) => own.get(b) - own.get(a) || people[a].name.localeCompare(people[b].name));
  let covered = left.filter((c) => c > 0).length;
  const curve = [n ? 1 - covered / n : 0];
  let busFactor = n && covered / n >= COVERAGE ? null : 0;
  for (let k = 0; k < order.length; k++) {
    for (const i of filesOf.get(order[k])) if (--left[i] === 0) covered--;
    if (busFactor === null && covered / n < COVERAGE) busFactor = k + 1;
    if (k < maxSteps) curve.push(1 - covered / n);
    else if (busFactor !== null) break;
  }
  return { busFactor: busFactor ?? 0, order, curve };
}

const goneSet = (people) => new Set(people.filter((p) => p.gone).map((p) => p.index));

/** Folders where one departure (or none) leaves most of the code unknown. */
function riskyFolders(model, removed, limit = 5) {
  const { entries, people } = model;
  const groups = new Map();
  for (const e of entries) {
    const parts = e.path.split("/").slice(0, -1);
    for (let d = 1; d <= Math.min(2, parts.length); d++) {
      const dir = parts.slice(0, d).join("/");
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(e);
    }
  }
  const min = Math.max(5, Math.ceil(entries.length * 0.02));
  const out = [];
  const risky = [...groups].filter(([, es]) => es.length >= min && es.length < entries.length).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [dir, es] of risky) {
    if (out.some((f) => dir.startsWith(`${f.dir}/`))) continue;
    const r = greedy(es, people, removed, 1);
    if (r.busFactor <= 1) out.push({ dir, files: es.length, busFactor: r.busFactor, holder: r.busFactor === 1 ? people[r.order[0]].name : null });
    if (out.length === limit) break;
  }
  return out;
}

/** Everything the report shows. */
export function summarize(model) {
  const { entries, people, commits } = model;
  const gone = goneSet(people);
  const today = greedy(entries, people, gone);
  const allTime = greedy(entries, people);
  const n = entries.length;
  const solo = new Map();
  let ghost = 0;
  for (const e of entries) {
    const active = e.authors.filter((a) => !gone.has(a));
    if (active.length === 1) solo.set(active[0], (solo.get(active[0]) || 0) + 1);
    if (!active.length) ghost++;
  }
  const holders = [...people]
    .filter((p) => p.files > 0)
    .sort((a, b) => Number(a.gone) - Number(b.gone) || b.files - a.files || a.name.localeCompare(b.name))
    .map((p) => ({ name: p.name, files: p.files, share: n ? p.files / n : 0, solo: solo.get(p.index) || 0, commits: p.commits, last: p.last, gone: p.gone }));
  return {
    files: n,
    commits,
    people: people.length,
    activePeople: people.filter((p) => !p.gone).length,
    goneMonths: model.goneMonths,
    busFactor: today.busFactor,
    allTimeBusFactor: allTime.busFactor,
    ghostFiles: ghost,
    ghostShare: n ? ghost / n : 0,
    curve: today.curve,
    allTimeCurve: allTime.curve,
    holders,
    folders: riskyFolders(model, gone),
  };
}

/** People whose name or email contains the query. */
export function findPeople(model, query) {
  const q = query.toLowerCase();
  return model.people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
}

/** What happens if these people leave, and who could pick up the pieces. */
export function whatIf(model, indexes) {
  const { entries, people } = model;
  const before = goneSet(people);
  const after = new Set([...before, ...indexes]);
  const has = (e, out) => e.authors.some((a) => !out.has(a));
  const lost = entries.filter((e) => has(e, before) && !has(e, after));
  const heirs = new Map();
  for (const e of lost) {
    for (const [p, n] of e.counts) {
      if (after.has(p)) continue;
      const h = heirs.get(p) || { files: 0, commits: 0 };
      h.files++;
      h.commits += n;
      heirs.set(p, h);
    }
  }
  const dirs = new Map();
  for (const e of lost) {
    const d = e.path.includes("/") ? e.path.split("/")[0] : ".";
    dirs.set(d, (dirs.get(d) || 0) + 1);
  }
  const n = entries.length;
  return {
    names: indexes.map((i) => people[i].name),
    lostFiles: lost.length,
    lostShare: n ? lost.length / n : 0,
    unknownShare: n ? entries.filter((e) => !has(e, after)).length / n : 0,
    busFactorBefore: greedy(entries, people, before).busFactor,
    busFactorAfter: greedy(entries, people, after).busFactor,
    folders: [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([dir, files]) => ({ dir, files })),
    heirs: [...heirs].sort((a, b) => b[1].files - a[1].files || b[1].commits - a[1].commits).slice(0, 3).map(([p, h]) => ({ name: people[p].name, ...h })),
  };
}
