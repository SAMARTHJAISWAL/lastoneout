// Reading `git log -z --numstat` as a stream of commits.

export const LOG_FORMAT = "%x01%H%x1f%aN%x1f%aE%x1f%at";

const STAT = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

export class LogParser {
  constructor(onCommit) {
    this.onCommit = onCommit;
    this.rest = "";
    this.commit = null;
    this.rename = null; // a rename's stat line is followed by two path tokens
  }

  feed(text) {
    const parts = (this.rest + text).split("\0");
    this.rest = parts.pop();
    for (const token of parts) this.token(token);
  }

  end() {
    if (this.rest.trim()) this.token(this.rest);
    this.rest = "";
    this.flush();
  }

  flush() {
    if (this.commit) this.onCommit(this.commit);
    this.commit = null;
  }

  token(raw) {
    if (this.rename) {
      if (this.rename.oldPath === null) {
        this.rename.oldPath = raw;
      } else {
        this.commit?.changes.push({ ...this.rename, path: raw });
        this.rename = null;
      }
      return;
    }
    const t = raw.replace(/^\n+/, "");
    if (t.startsWith("\x01")) {
      this.flush();
      const [sha, name, email, time] = t.slice(1).trimEnd().split("\x1f");
      this.commit = { sha, name, email, time: Number(time), changes: [] };
      return;
    }
    const m = STAT.exec(t);
    if (!m) return;
    const binary = m[1] === "-";
    if (m[3]) this.commit?.changes.push({ path: m[3], oldPath: null, binary });
    else this.rename = { oldPath: null, binary };
  }
}

/** Every file's history, and everyone who has committed, as raw git identities. */
export class Ledger {
  constructor() {
    this.identities = new Map();
    this.files = new Map();
    this.commits = 0;
  }

  add({ name, email, time, changes }) {
    const key = `${name}\x1f${email}`;
    let who = this.identities.get(key);
    if (!who) {
      who = { id: this.identities.size, name, email, commits: 0, last: 0 };
      this.identities.set(key, who);
    }
    who.commits++;
    who.last = Math.max(who.last, time);
    this.commits++;
    for (const c of changes) {
      if (c.oldPath && this.files.has(c.oldPath)) {
        this.files.set(c.path, this.files.get(c.oldPath));
        this.files.delete(c.oldPath);
      }
      let f = this.files.get(c.path);
      if (!f) {
        f = { creator: who.id, counts: new Map(), binary: false };
        this.files.set(c.path, f);
      }
      f.counts.set(who.id, (f.counts.get(who.id) || 0) + 1);
      f.binary = c.binary;
    }
  }
}
