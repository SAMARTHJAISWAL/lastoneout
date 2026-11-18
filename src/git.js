// Talking to git.
import { execFileSync, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { LOG_FORMAT, Ledger, LogParser } from "./log.js";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });

export function checkRepo(repo) {
  try {
    git(repo, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    let isRepo = true;
    try {
      git(repo, ["rev-parse", "--git-dir"]);
    } catch {
      isRepo = false;
    }
    throw new Error(isRepo ? "this repository has no commits yet" : `${repo} is not a git repository`);
  }
  return { shallow: git(repo, ["rev-parse", "--is-shallow-repository"]).trim() === "true" };
}

export const headFiles = (repo) => git(repo, ["ls-tree", "-r", "-z", "--full-tree", "--name-only", "HEAD"]).split("\0").filter(Boolean);

export function readHistory(repo) {
  return new Promise((resolve, reject) => {
    const ledger = new Ledger();
    const parser = new LogParser((c) => ledger.add(c));
    const decoder = new StringDecoder("utf8");
    const child = spawn("git", ["-C", repo, "-c", "diff.renameLimit=2000", "log", "-z", "--reverse", "--no-merges", "--find-renames", "--numstat", `--format=${LOG_FORMAT}`, "HEAD"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stdout.on("data", (b) => parser.feed(decoder.write(b)));
    child.stderr.on("data", (b) => (err = (err + b).slice(-500)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) return reject(new Error(`git log failed: ${err.trim()}`));
      parser.feed(decoder.end());
      parser.end();
      resolve(ledger);
    });
  });
}
