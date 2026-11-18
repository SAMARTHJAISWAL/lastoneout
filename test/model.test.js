import { test } from "node:test";
import assert from "node:assert/strict";
import { isCode } from "../src/filter.js";
import { Ledger, LogParser } from "../src/log.js";
import { aliasKeys, authorsOf, buildModel, doa, findPeople, greedy, isBot, mergeIdentities, summarize, whatIf } from "../src/model.js";
import { badgeUrl, cardOf, pack, unpack } from "../src/share.js";
import { ago, render, verdict } from "../src/terminal.js";

const NOW = 1_800_000_000;
const DAY = 86400;

/** A ledger from [who, days ago, [paths or [old, new]]] rows, oldest first. */
function ledgerOf(rows) {
  const l = new Ledger();
  for (const [who, days, paths] of rows) {
    l.add({
      name: who,
      email: `${who.toLowerCase().replace(/\W/g, "")}@work.io`,
      time: NOW - days * DAY,
      changes: paths.map((p) => (Array.isArray(p) ? { oldPath: p[0], path: p[1], binary: false } : { oldPath: null, path: p, binary: false })),
    });
  }
  return l;
}

const model = (rows, head, opts = {}) => buildModel(ledgerOf(rows), head, { now: NOW, ...opts });

test("the log parser reads plain changes, renames, binaries and empty commits", () => {
  const seen = [];
  const p = new LogParser((c) => seen.push(c));
  const text =
    "\x01aaa\x1fAna Díaz\x1fana@x.io\x1f100\0\n3\t1\tsrc/a b.js\0-\t-\tlogo.png\0" +
    "\x01bbb\x1fBo\x1fbo@x.io\x1f200\0" +
    "\x01ccc\x1fBo\x1fbo@x.io\x1f300\0\n0\t0\t\0src/a b.js\0src/c.js\0";
  // split mid-token: the parser must cope with any chunking
  for (let i = 0; i < text.length; i += 7) p.feed(text.slice(i, i + 7));
  p.end();
  assert.equal(seen.length, 3);
  assert.equal(seen[0].name, "Ana Díaz");
  assert.deepEqual(seen[0].changes.map((c) => [c.path, c.binary]), [["src/a b.js", false], ["logo.png", true]]);
  assert.equal(seen[1].changes.length, 0);
  assert.deepEqual(seen[2].changes[0], { oldPath: "src/a b.js", binary: false, path: "src/c.js" });
});

test("DOA follows the published formula", () => {
  assert.ok(Math.abs(doa(true, 1, 0) - (3.293 + 1.098 + 0.164)) < 1e-9);
  assert.ok(Math.abs(doa(false, 2, 3) - (3.293 + 0.328 - 0.321 * Math.log(4))) < 1e-9);
});

test("the creator with steady work is the author; a drive-by fix is not", () => {
  assert.deepEqual(authorsOf(0, new Map([[0, 10], [1, 1]])), [0]);
});

test("two people working equally on a file are both authors", () => {
  assert.deepEqual(authorsOf(0, new Map([[0, 8], [1, 8]])).sort(), [0, 1]);
});

test("heavy later work takes over a file from its creator", () => {
  assert.deepEqual(authorsOf(0, new Map([[0, 1], [1, 40]])), [1]);
});

test("identities merge by email, name and GitHub noreply handle", () => {
  const { people, personOf } = mergeIdentities([
    { id: 0, name: "Ana Diaz", email: "ana@work.io", commits: 5, last: 1 },
    { id: 1, name: "ana", email: "ana@work.io", commits: 1, last: 9 },
    { id: 2, name: "A. D.", email: "123+anadiaz@users.noreply.github.com", commits: 2, last: 3 },
    { id: 3, name: "root", email: "root@localhost", commits: 2, last: 3 },
    { id: 4, name: "root", email: "root@localhost.localdomain", commits: 2, last: 3 },
    { id: 5, name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com", commits: 90, last: 9 },
  ]);
  assert.equal(personOf.get(0), personOf.get(1));
  assert.equal(personOf.get(0), personOf.get(2));
  assert.notEqual(personOf.get(3), personOf.get(4), "generic names don't merge strangers");
  assert.equal(personOf.get(5), undefined, "bots are not people");
  assert.equal(people[personOf.get(0)].name, "Ana Diaz");
  assert.equal(people[personOf.get(0)].commits, 8);
  assert.equal(people[personOf.get(0)].last, 9);
});

test("short names and accented spellings still merge", () => {
  const { personOf } = mergeIdentities([
    { id: 0, name: "drh", email: "drh@noemail.net", commits: 9, last: 1 },
    { id: 1, name: "drh", email: "", commits: 5, last: 9 },
    { id: 2, name: "Ulises Gascón", email: "a@x.io", commits: 1, last: 1 },
    { id: 3, name: "Ulises Gascon", email: "b@y.io", commits: 1, last: 1 },
  ]);
  assert.equal(personOf.get(0), personOf.get(1));
  assert.equal(personOf.get(2), personOf.get(3));
});

test("bots and generic addresses are recognised", () => {
  for (const name of ["dependabot[bot]", "renovate[bot]", "github-actions", "release-bot"]) assert.ok(isBot({ name, email: "x@y.z" }), name);
  assert.ok(!isBot({ name: "Abbot Hall", email: "a@b.c" }));
  assert.deepEqual(aliasKeys({ name: "root", email: "you@example.com" }), []);
});

test("only hand-written code counts", () => {
  for (const p of ["src/a.js", "lib/x/y.rs", "Makefile", "tests/test_a.py", "cmd/main.go", "core/util.h"]) assert.ok(isCode(p), p);
  for (const p of ["README.md", "vendor/a.go", "node_modules/x/i.js", "docs/a.py", "dist/a.js", "a.min.js", "package-lock.json", "logo.png", "x.pb.go", "third_party/z.c", "examples/a.js", "LICENSE"]) assert.ok(!isCode(p), p);
});

test("history follows renames, ignores deleted files and binaries", () => {
  const l = ledgerOf([["Ana", 5, ["old.js", "gone.js"]], ["Ana", 4, [["old.js", "new.js"]]]]);
  l.add({ name: "Ana", email: "ana@work.io", time: NOW, changes: [{ oldPath: null, path: "bin.c", binary: true }] });
  const m = buildModel(l, ["new.js", "bin.c"], { now: NOW });
  assert.deepEqual(m.entries.map((e) => e.path), ["new.js"]);
  assert.equal(m.entries[0].counts.get(0), 2);
});

const team = [
  ["Ana", 30, ["a1.js", "a2.js", "a3.js", "a4.js"]],
  ["Ben", 30, ["b1.js", "b2.js"]],
  ["Cy", 30, ["c1.js"]],
  ["Old Timer", 900, ["o1.js"]],
];
const head = ["a1.js", "a2.js", "a3.js", "a4.js", "b1.js", "b2.js", "c1.js", "o1.js"];

test("the bus factor removes top authors until coverage drops below half", () => {
  const m = model(team, head);
  const s = summarize(m);
  // 8 files, one already without an active author. Ana leaving leaves 3/8 covered.
  assert.equal(s.busFactor, 1);
  assert.deepEqual(s.curve.slice(0, 3).map((x) => Math.round(x * 8)), [1, 5, 7]);
  // counting Old Timer, Ana leaving leaves exactly half: it takes Ben too
  assert.equal(s.allTimeBusFactor, 2);
  assert.equal(s.ghostFiles, 1);
  assert.equal(s.people, 4);
  assert.equal(s.activePeople, 3);
  assert.deepEqual(s.holders.map((h) => [h.name, h.files, h.solo, h.gone]), [
    ["Ana", 4, 4, false], ["Ben", 2, 2, false], ["Cy", 1, 1, false], ["Old Timer", 1, 0, true],
  ]);
});

test("shared files raise the bus factor", () => {
  const rows = [];
  for (let i = 0; i < 20; i++) for (const who of ["Ana", "Ben", "Cy"]) rows.push([who, 10, ["x.js", "y.js"]]);
  assert.equal(summarize(model(rows, ["x.js", "y.js"])).busFactor, 3);
});

test("a project whose authors have all gone quiet scores zero", () => {
  const s = summarize(model([["Ana", 800, ["a.js", "b.js"]]], ["a.js", "b.js"]));
  assert.equal(s.busFactor, 0);
  assert.equal(s.allTimeBusFactor, 1);
  assert.match(verdict(s), /Already past the line/);
});

test("--gone-after moves the line", () => {
  assert.equal(summarize(model([["Ana", 800, ["a.js"]]], ["a.js"], { goneMonths: 36 })).busFactor, 1);
});

test("greedy handles an empty project", () => {
  assert.deepEqual(greedy([], []).curve, [0]);
  assert.equal(greedy([], []).busFactor, 0);
});

test("risky folders name their one holder", () => {
  const rows = [["Ana", 5, ["api/a.js", "api/b.js", "api/c.js", "api/d.js", "api/e.js"]], ["Ben", 5, ["ui/a.js", "ui/b.js", "ui/c.js", "ui/d.js", "ui/e.js"]]];
  const paths = rows.flatMap((r) => r[2]);
  assert.deepEqual(summarize(model(rows, paths)).folders, [
    { dir: "api", files: 5, busFactor: 1, holder: "Ana" },
    { dir: "ui", files: 5, busFactor: 1, holder: "Ben" },
  ]);
});

test("--path limits the report to one folder, matching whole path segments", () => {
  const rows = [["Ana", 5, ["api/a.js", "api2/b.js", "c.js"]]];
  assert.deepEqual(model(rows, rows[0][2], { path: "./api/" }).entries.map((e) => e.path), ["api/a.js"]);
});

test("what-if counts the lost files and finds who could take over", () => {
  const rows = [["Ana", 5, ["src/a.js", "src/b.js", "c.js"]], ["Ana", 4, ["src/a.js", "src/b.js", "c.js"]], ["Ben", 3, ["src/a.js"]], ["Ben", 2, ["d.js"]]];
  const m = model(rows, ["src/a.js", "src/b.js", "c.js", "d.js"]);
  const w = whatIf(m, [findPeople(m, "ana")[0].index]);
  assert.equal(w.lostFiles, 3);
  assert.equal(w.lostShare, 0.75);
  assert.equal(w.busFactorBefore, 1);
  assert.equal(w.busFactorAfter, 0);
  assert.deepEqual(w.folders, [{ dir: "src", files: 2 }, { dir: ".", files: 1 }]);
  assert.deepEqual(w.heirs, [{ name: "Ben", files: 1, commits: 1 }]);
});

test("share cards carry totals and no names", () => {
  const s = summarize(model(team, head));
  const card = cardOf("my-repo", s);
  assert.deepEqual(unpack(pack(card)), card);
  assert.ok(!/Ana|Ben|Cy|Timer/.test(JSON.stringify(card)));
  assert.throws(() => unpack(pack({ ...card, b: -1 })));
  assert.throws(() => unpack(pack({ v: 2 })));
  assert.throws(() => unpack("%%%"));
});

test("badges and dates read well", () => {
  assert.match(badgeUrl(1), /bus%20factor-1-red$/);
  assert.match(badgeUrl(6), /-brightgreen$/);
  assert.equal(ago(NOW, NOW), "today");
  assert.equal(ago(NOW - DAY, NOW), "1 day ago");
  assert.equal(ago(NOW - 90 * DAY, NOW), "3 months ago");
  assert.equal(ago(NOW - 800 * DAY, NOW), "2 years ago");
});

test("the report has no color codes unless asked", () => {
  const s = summarize(model(team, head));
  const text = render("repo", s, { now: NOW });
  assert.ok(!text.includes("\x1b["));
  assert.match(text, /BUS FACTOR {2}1/);
  assert.match(render("repo", { ...s, files: 1, commits: 1 }, { now: NOW }), /1 code file · 1 commit ·/);
  assert.ok(render("repo", s, { now: NOW, color: true }).includes("\x1b["));
});
