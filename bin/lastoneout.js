#!/usr/bin/env node
// lastoneout: how many people can leave before your code has no active author?

import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { checkRepo, headFiles, readHistory } from "../src/git.js";
import { buildModel, findPeople, summarize, whatIf } from "../src/model.js";
import { badgeUrl, cardOf, pack } from "../src/share.js";
import { render, renderWhatIf } from "../src/terminal.js";

const VERSION = "0.1.0";
const SITE = "https://lastoneout.vercel.app/";

const USAGE = `lastoneout: how many people can leave before your code has no active author?

Usage:
  lastoneout [repo]              report on a git repository (default: here)
  lastoneout --what-if NAME      what happens if this person leaves (repeatable)

Options:
  --path DIR         only look at one folder
  --gone-after N     months without a commit before someone counts as gone (12)
  --all-files        count every text file, not just code
  --top N            how many people to list (5)
  --min N            exit 1 if the bus factor is below N (for CI)
  --badge            print a README badge
  --share            print a link to a card with totals only, no names
  --json             print the numbers as JSON
  --no-color         plain text
  -h, --help         show this help
  -v, --version      show the version

Everything runs on your machine, from your git history. Nothing is uploaded.
`;

function args(argv) {
  const o = { repo: ".", whatIf: [], goneMonths: 12, top: 5, color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR };
  const number = (flag, text, min) => {
    const v = Number(text);
    if (!Number.isInteger(v) || v < min) throw new Error(`${flag} needs a whole number of at least ${min}`);
    return v;
  };
  let positional = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "--what-if") o.whatIf.push(value());
    else if (a === "--path") o.path = value();
    else if (a === "--gone-after") o.goneMonths = number(a, value(), 1);
    else if (a === "--top") o.top = number(a, value(), 1);
    else if (a === "--min") o.min = number(a, value(), 0);
    else if (a === "--all-files") o.allFiles = true;
    else if (a === "--badge") o.badge = true;
    else if (a === "--share") o.share = true;
    else if (a === "--json") o.json = true;
    else if (a === "--no-color") o.color = false;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else if (positional) throw new Error(`unexpected argument ${a}`);
    else {
      o.repo = a;
      positional = true;
    }
  }
  return o;
}

function repoLabel(repo) {
  let url = "";
  try {
    url = execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // no remote: use the folder name
  }
  const name = url.replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/\.git$/, "");
  return name || basename(resolve(repo));
}

function fail(message, code = 1) {
  process.stderr.write(`lastoneout: ${message}\n`);
  process.exit(code);
}

async function main() {
  let o;
  try {
    o = args(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`lastoneout: ${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (o.help) return void process.stdout.write(USAGE);
  if (o.version) return void process.stdout.write(`lastoneout ${VERSION}\n`);

  let info;
  try {
    info = checkRepo(o.repo);
  } catch (e) {
    fail(e.message);
  }
  const ledger = await readHistory(o.repo);
  const model = buildModel(ledger, headFiles(o.repo), { goneMonths: o.goneMonths, allFiles: o.allFiles, path: o.path });
  if (!model.entries.length) fail(`no code files found${o.path ? ` under ${o.path}` : ""}. Try --all-files to count every text file.`);

  const s = summarize(model);
  const label = repoLabel(o.repo) + (o.path ? `/${o.path.replace(/^\.\/|\/+$/g, "")}` : "");
  const picked = [];
  for (const q of o.whatIf) {
    const found = findPeople(model, q);
    if (!found.length) fail(`nobody matching "${q}" has committed here`);
    if (found.length > 1) fail(`"${q}" matches ${found.length} people: ${found.slice(0, 5).map((p) => p.name).join(", ")}. Be more specific.`);
    picked.push(found[0].index);
  }
  const what = picked.length ? whatIf(model, picked) : null;

  if (o.json) {
    process.stdout.write(`${JSON.stringify(what ? { ...s, whatIf: what } : s, null, 2)}\n`);
  } else if (o.badge) {
    process.stdout.write(`[![Bus factor: ${s.busFactor}](${badgeUrl(s.busFactor)})](https://github.com/SAMARTHJAISWAL/lastoneout)\n`);
  } else if (o.share) {
    process.stdout.write(`${SITE}#${pack(cardOf(label, s))}\n`);
  } else if (what) {
    process.stdout.write(renderWhatIf(what, { color: o.color }));
  } else {
    process.stdout.write(render(label, s, { color: o.color, top: o.top }));
    if (info.shallow) process.stdout.write("  This is a shallow clone, so older history is missing. Run `git fetch --unshallow` for a true result.\n\n");
    const first = s.holders.find((h) => !h.gone);
    if (first) process.stdout.write(`  Try: lastoneout --what-if "${first.name}"\n\n`);
  }
  if (o.min !== undefined && s.busFactor < o.min) fail(`bus factor ${s.busFactor} is below the required ${o.min}`);
}

main().catch((e) => fail(e.message));
