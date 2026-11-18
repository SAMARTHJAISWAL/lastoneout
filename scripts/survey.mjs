// Measure well-known open-source projects for the site's leaderboard.
//
//   SURVEY_CACHE=/some/dir node scripts/survey.mjs [owner/repo ...]
//
// Clones each repository in full (bus factors need the whole history), runs
// the same analysis as the command line, and writes data/survey.json. It stores
// totals only: nobody's name goes on the leaderboard.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { headFiles, readHistory } from "../src/git.js";
import { buildModel, summarize } from "../src/model.js";

const run = promisify(execFile);
const REPOS = `expressjs/express pallets/flask psf/requests fastapi/fastapi django/django vuejs/core sveltejs/svelte
facebook/react vitejs/vite webpack/webpack prettier/prettier axios/axios lodash/lodash moment/moment colinhacks/zod
tailwindlabs/tailwindcss bigskysoftware/htmx zloirock/core-js rails/rails Homebrew/brew ohmyzsh/ohmyzsh
curl/curl redis/redis nginx/nginx sqlite/sqlite tmux/tmux jqlang/jq neovim/neovim
BurntSushi/ripgrep sharkdp/bat tokio-rs/tokio astral-sh/ruff astral-sh/uv
gin-gonic/gin spf13/cobra junegunn/fzf ollama/ollama numpy/numpy`.split(/\s+/);

const repos = process.argv.slice(2).length ? process.argv.slice(2) : REPOS;
const cache = process.env.SURVEY_CACHE || new URL("../.survey-cache", import.meta.url).pathname;
const out = new URL("../data/survey.json", import.meta.url);
const now = Math.floor(Date.now() / 1000);
await mkdir(cache, { recursive: true });

let results = [];
if (process.argv.length > 2 && existsSync(out)) results = JSON.parse(await readFile(out, "utf8")).repos;

async function survey(repo) {
  const dir = join(cache, `${repo.replace("/", "__")}.git`);
  if (!existsSync(dir)) {
    await run("git", ["clone", "-q", "--bare", "--single-branch", `https://github.com/${repo}.git`, dir], { timeout: 25 * 60_000 });
  }
  const sha = (await run("git", ["-C", dir, "rev-parse", "HEAD"])).stdout.trim();
  const model = buildModel(await readHistory(dir), headFiles(dir), { now });
  const s = summarize(model);
  return {
    repo,
    sha,
    busFactor: s.busFactor,
    allTimeBusFactor: s.allTimeBusFactor,
    files: s.files,
    commits: s.commits,
    people: s.people,
    activePeople: s.activePeople,
    withoutAuthor: Math.round(s.ghostShare * 100),
    curve: s.curve.map((x) => Math.round(x * 100)),
    allTimeCurve: s.allTimeCurve.map((x) => Math.round(x * 100)),
  };
}

const queue = [...repos];
async function worker() {
  for (let repo = queue.shift(); repo; repo = queue.shift()) {
    const started = Date.now();
    try {
      const r = await survey(repo);
      results = results.filter((x) => x.repo !== repo).concat(r);
      console.log(`${repo}: ${r.busFactor} (all-time ${r.allTimeBusFactor}), ${r.files} files, ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (e) {
      console.log(`${repo}: FAILED ${e.message.slice(0, 200)}`);
    }
    results.sort((a, b) => a.repo.localeCompare(b.repo));
    await writeFile(out, `${JSON.stringify({ measured: new Date(now * 1000).toISOString().slice(0, 10), repos: results }, null, 1)}\n`);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`done: ${results.length} of ${repos.length}`);
