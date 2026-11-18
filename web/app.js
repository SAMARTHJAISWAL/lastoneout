// The lastoneout page: the leaderboard, and a card from a share link.
import { unpack } from "./share.js";

const $ = (id) => document.getElementById(id);
const n = (x) => x.toLocaleString("en-US");
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The share of code without an active author, as k people leave. */
function curveSvg(curve) {
  const w = 560, h = 150, left = 34, bottom = 24, top = 8;
  const last = Math.max(1, curve.length - 1);
  const x = (k) => left + (k / last) * (w - left - 8);
  const y = (p) => top + (1 - p / 100) * (h - top - bottom);
  const line = curve.map((p, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(p).toFixed(1)}`).join("");
  const dots = curve.map((p, k) => `<circle cx="${x(k).toFixed(1)}" cy="${y(p).toFixed(1)}" r="3.5"><title>${k} gone: ${p}% without an author</title></circle>`).join("");
  const ticks = curve.map((_, k) => (k % Math.ceil(curve.length / 8) ? "" : `<text x="${x(k).toFixed(1)}" y="${h - 7}" text-anchor="middle">${k}</text>`)).join("");
  return `<svg class="curve" viewBox="0 0 ${w} ${h}" role="img" aria-label="Share of code without an active author as top people leave">
    <line class="half" x1="${left}" x2="${w - 8}" y1="${y(50)}" y2="${y(50)}"/>
    <text x="${left - 6}" y="${y(50) + 4}" text-anchor="end">50%</text>
    <text x="${left - 6}" y="${y(100) + 8}" text-anchor="end">100%</text>
    <text x="${left - 6}" y="${y(0) + 2}" text-anchor="end">0</text>
    <path d="${line}"/>${dots}${ticks}</svg>
    <p class="axis">People leaving, biggest author first</p>`;
}

const tone = (b) => (b <= 1 ? "bad" : b === 2 ? "warn" : b <= 4 ? "ok" : "good");

function details(r, curve = r.curve) {
  return `<div class="stats">
      <span><b>${n(r.files)}</b> code file${r.files === 1 ? "" : "s"}</span>
      <span><b>${n(r.commits)}</b> commit${r.commits === 1 ? "" : "s"}</span>
      <span><b>${n(r.activePeople)}</b> of ${n(r.people)} ${r.people === 1 ? "person" : "people"} active</span>
      <span><b>${r.withoutAuthor}%</b> without an active author today</span>
    </div>${curveSvg(curve)}`;
}

// ---------------------------------------------------------------------------

function fromHash() {
  $("yours").hidden = true;
  if (location.hash.length <= 1) return;
  try {
    const c = unpack(location.hash.slice(1));
    $("your-name").textContent = c.r;
    $("your-card").innerHTML = `<div class="card"><div class="big ${tone(c.b)}">${c.b}</div><div><b>bus factor</b><br><span class="small">${c.t === c.b ? "" : `${c.t} counting people who have gone quiet`}</span></div></div>${details({ files: c.f, commits: c.c, activePeople: c.a, people: c.p, withoutAuthor: c.g, curve: c.o })}`;
    $("yours").hidden = false;
  } catch {
    // a broken link just shows the normal page
  }
}
addEventListener("hashchange", fromHash);
fromHash();

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("cmd").textContent);
    $("copy").textContent = "Copied";
  } catch {
    getSelection().selectAllChildren($("cmd"));
  }
});

// ---------------------------------------------------------------------------

const survey = await (await fetch("survey.json")).json();
$("about").textContent = `${survey.repos.length} projects, measured ${survey.measured} from their full git history. Tap one for its curve.`;
let key = "allTimeBusFactor";
const curveKey = () => (key === "busFactor" ? "curve" : "allTimeCurve");

function draw() {
  const rows = [...survey.repos].sort((a, b) => a[key] - b[key] || b.files - a.files);
  $("board").innerHTML = rows
    .map((r) => `<li><details><summary><span class="score ${tone(r[key])}">${r[key]}</span><span class="name">${esc(r.repo)}</span><span class="meta">${n(r.people)} people</span></summary>
      <div class="more">${details(r, r[curveKey()])}<a href="https://github.com/${esc(r.repo)}/tree/${r.sha}">Code measured</a></div></details></li>`)
    .join("");
}

function pick(k, on, off) {
  key = k;
  $(on).classList.add("on");
  $(off).classList.remove("on");
  draw();
}
$("by-today").addEventListener("click", () => pick("busFactor", "by-today", "by-all"));
$("by-all").addEventListener("click", () => pick("allTimeBusFactor", "by-all", "by-today"));
draw();
