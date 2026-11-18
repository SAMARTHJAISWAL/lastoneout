// Assemble the static site in _site/.
import { cp, mkdir, rm } from "node:fs/promises";

const out = new URL("../_site/", import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of ["index.html", "style.css", "app.js", "vercel.json", "favicon.svg", "og.png"]) {
  await cp(new URL(`../web/${f}`, import.meta.url), new URL(f, out)).catch((e) => {
    if (f !== "og.png") throw e;
  });
}
await cp(new URL("../src/share.js", import.meta.url), new URL("share.js", out));
await cp(new URL("../data/survey.json", import.meta.url), new URL("survey.json", out));
console.log("built _site/");
