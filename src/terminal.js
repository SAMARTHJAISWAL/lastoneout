// The report, as text.

const n = (x) => x.toLocaleString("en-US");
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (k, word) => `${n(k)} ${word}${k === 1 ? "" : "s"}`;

export function ago(seconds, now) {
  const days = Math.floor((now - seconds) / 86400);
  if (days < 1) return "today";
  if (days < 60) return plural(days, "day") + " ago";
  if (days < 730) return plural(Math.round(days / 30.44), "month") + " ago";
  return plural(Math.floor(days / 365.25), "year") + " ago";
}

function painter(color) {
  const wrap = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { bold: wrap(1), dim: wrap(2), red: wrap(31), green: wrap(32), yellow: wrap(33), cyan: wrap(36) };
}

export function verdict(s) {
  const b = s.busFactor;
  if (b === 0) return `Already past the line: the main authors of most of this code have not committed in ${s.goneMonths} months.`;
  if (b === 1) return "If one person leaves, more than half of this code has no active author.";
  return `It takes ${b} people leaving before more than half of this code has no active author.`;
}

const bar = (share, width) => {
  const full = Math.round(share * width);
  return "█".repeat(full) + "░".repeat(width - full);
};

export function render(label, s, { color = false, now = Date.now() / 1000, top = 5 } = {}) {
  const c = painter(color);
  const tone = s.busFactor <= 1 ? c.red : s.busFactor === 2 ? c.yellow : c.green;
  const out = [""];
  out.push(`  ${c.bold("lastoneout")} ${c.dim("·")} ${label}`);
  out.push(c.dim(`  ${n(s.files)} code files · ${n(s.commits)} commits · ${plural(s.people, "person").replace("persons", "people")}, ${n(s.activePeople)} active`));
  out.push("");
  out.push(`  ${c.bold("BUS FACTOR")}  ${tone(c.bold(s.busFactor))}`);
  out.push(`  ${verdict(s)}`);
  if (s.allTimeBusFactor !== s.busFactor) out.push(c.dim(`  Counting people who have since gone quiet, it would be ${s.allTimeBusFactor}.`));
  out.push("");
  out.push(c.bold("  IF THE TOP PEOPLE LEAVE, ONE AT A TIME"));
  const rows = Math.min(s.curve.length, Math.max(s.busFactor + 2, 3));
  for (let k = 0; k < rows; k++) {
    const label2 = k === 0 ? "today" : `${k} gone`;
    const painted = s.curve[k] > 0.5 ? c.red : (x) => x;
    out.push(`  ${label2.padEnd(8)}${painted(bar(s.curve[k], 30))} ${pct(s.curve[k])} of the code without an author`);
  }
  const active = s.holders.filter((h) => !h.gone).slice(0, top);
  if (active.length) {
    out.push("");
    out.push(c.bold("  WHO HOLDS IT"));
    const width = Math.min(24, Math.max(...active.map((h) => [...h.name].length)));
    for (const h of active) {
      const name = [...h.name].slice(0, width).join("").padEnd(width);
      out.push(`  ${c.cyan(name)}  ${plural(h.files, "file").padEnd(10)} ${pct(h.share).padStart(4)}  ${n(h.solo)} alone  ${c.dim(`last commit ${ago(h.last, now)}`)}`);
    }
  }
  if (s.ghostFiles) {
    out.push("");
    out.push(c.bold("  ALREADY WITHOUT AN AUTHOR"));
    out.push(`  ${plural(s.ghostFiles, "file")} (${pct(s.ghostShare)}) have no main author who committed in the last ${s.goneMonths} months.`);
  }
  if (s.folders.length) {
    out.push("");
    out.push(c.bold("  ONE DEPARTURE FROM TROUBLE"));
    for (const f of s.folders) {
      const who = f.busFactor === 0 ? c.red("nobody active") : `only ${c.cyan(f.holder)}`;
      out.push(`  ${`${f.dir}/`.padEnd(26)} ${plural(f.files, "file").padEnd(10)} ${who}`);
    }
  }
  out.push("");
  return `${out.join("\n")}\n`;
}

export function renderWhatIf(w, { color = false } = {}) {
  const c = painter(color);
  const out = [""];
  out.push(`  ${c.bold("WHAT IF")} ${w.names.map(c.cyan).join(", ")} ${w.names.length === 1 ? "leaves" : "leave"}?`);
  out.push(`  ${plural(w.lostFiles, "file")} (${pct(w.lostShare)}) would be left with no active author.`);
  out.push(`  Code without an author would reach ${pct(w.unknownShare)}. Bus factor: ${w.busFactorBefore} → ${c.bold(w.busFactorAfter)}.`);
  if (w.folders.length) {
    out.push("");
    out.push(c.bold("  HARDEST HIT"));
    for (const f of w.folders) out.push(`  ${(f.dir === "." ? "(top level)" : `${f.dir}/`).padEnd(26)} ${plural(f.files, "file")}`);
  }
  if (w.heirs.length) {
    out.push("");
    out.push(c.bold("  BEST PLACED TO TAKE OVER"));
    for (const h of w.heirs) out.push(`  ${c.cyan(h.name)}: has touched ${n(h.files)} of those files`);
  } else if (w.lostFiles) {
    out.push("", "  Nobody else has touched those files.");
  }
  out.push("");
  return `${out.join("\n")}\n`;
}
