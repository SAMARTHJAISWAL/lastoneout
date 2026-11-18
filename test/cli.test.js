// The command line, end to end, on a real temporary git repository.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unpack } from "../src/share.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "lastoneout.js");
let repo;
const recent = new Date(Date.now() - 5 * 86400_000).toISOString();

function commit(who, message, date = recent) {
  const email = `${who.toLowerCase()}@work.io`;
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message], {
    env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

const write = (p, text) => {
  mkdirSync(dirname(join(repo, p)), { recursive: true });
  writeFileSync(join(repo, p), text);
};

const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });

before(() => {
  repo = mkdtempSync(join(tmpdir(), "lastoneout-"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  for (let i = 0; i < 4; i++) write(`src/mod${i}.js`, `export const a = ${i};\n`);
  write("README.md", "# hi\n");
  commit("Ana", "start");
  write("src/ünï côde.py", "x = 1\n");
  write("tools/run.sh", "echo hi\n");
  commit("Ben", "add tools");
  renameSync(join(repo, "src/mod0.js"), join(repo, "src/renamed.js"));
  commit("Ana", "rename");
});

after(() => rmSync(repo, { recursive: true, force: true }));

test("reports the bus factor and the people holding the code", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BUS FACTOR {2}1/);
  assert.match(r.stdout, /6 code files · 3 commits · 2 people, 2 active/);
  assert.match(r.stdout, /Ana +4 files/);
  assert.match(r.stdout, /Ben +2 files/);
  assert.ok(!r.stdout.includes("\x1b["), "no color when piped");
});

test("--json gives the numbers, with renames and non-ASCII paths handled", () => {
  const s = JSON.parse(run("--json").stdout);
  assert.equal(s.files, 6);
  assert.equal(s.busFactor, 1);
  assert.equal(s.holders[0].name, "Ana");
});

test("--what-if shows the damage and refuses unknown or ambiguous names", () => {
  const r = run("--what-if", "ana");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /WHAT IF Ana leaves/);
  assert.match(r.stdout, /4 files \(67%\)/);
  const none = run("--what-if", "zed");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /nobody matching "zed"/);
  const both = run("--what-if", "work.io");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /matches 2 people/);
});

test("--min fails the build when the bus factor is too low", () => {
  assert.equal(run("--min", "1", "--json").status, 0);
  const r = run("--min", "3", "--badge");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bus factor 1 is below the required 3/);
  assert.match(r.stdout, /bus%20factor-1-red/);
});

test("--share prints a link with totals and no names", () => {
  const link = run("--share").stdout.trim();
  const card = unpack(link.split("#")[1]);
  assert.equal(card.b, 1);
  assert.equal(card.f, 6);
  assert.ok(!link.includes("Ana"));
});

test("--path and --gone-after work, and bad input is explained", () => {
  assert.equal(JSON.parse(run("--path", "tools", "--json").stdout).files, 1);
  assert.match(run("--path", "nope").stderr, /no code files found under nope/);
  assert.equal(run("--gone-after", "x").status, 2);
  assert.equal(run("--wat").status, 2);
  assert.match(run("--help").stdout, /Usage:/);
  assert.match(run("--version").stdout, /^lastoneout \d/);
  const empty = mkdtempSync(join(tmpdir(), "lastoneout-empty-"));
  const r = spawnSync(process.execPath, [BIN, empty], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a git repository/);
  rmSync(empty, { recursive: true, force: true });
});
