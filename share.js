// The share link: totals only, after the "#", with nobody's name in it.

export function cardOf(label, s) {
  return {
    v: 1,
    r: label.slice(0, 60),
    b: s.busFactor,
    t: s.allTimeBusFactor,
    f: s.files,
    c: s.commits,
    p: s.people,
    a: s.activePeople,
    g: Math.round(s.ghostShare * 100),
    o: s.curve.map((x) => Math.round(x * 100)),
  };
}

const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64 = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const pack = (card) => toBase64(JSON.stringify(card));

export function unpack(text) {
  const c = JSON.parse(fromBase64(text));
  const whole = (x) => Number.isInteger(x) && x >= 0;
  const ok = c && c.v === 1 && typeof c.r === "string" && [c.b, c.t, c.f, c.c, c.p, c.a, c.g].every(whole) && Array.isArray(c.o) && c.o.length > 0 && c.o.every((x) => whole(x) && x <= 100);
  if (!ok) throw new Error("not a lastoneout card");
  return c;
}

export function badgeUrl(busFactor) {
  const color = busFactor <= 1 ? "red" : busFactor === 2 ? "orange" : busFactor <= 4 ? "yellow" : "brightgreen";
  return `https://img.shields.io/badge/bus%20factor-${busFactor}-${color}`;
}
