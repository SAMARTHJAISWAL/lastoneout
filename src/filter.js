// Which files count as the code a team has to understand.

const CODE = new Set(
  `c h cc cpp cxx hh hpp hxx m mm rs go zig d nim odin v s asm
   java kt kts scala groovy clj cljs cljc cs fs fsx vb swift dart
   js jsx mjs cjs ts tsx mts cts vue svelte astro coffee
   py pyx pxd pyi rb rake php pl pm lua r jl ex exs erl hrl gleam
   hs lhs ml mli elm purs lisp el rkt scm sh bash zsh fish ps1 psm1
   sql sol tf f f90 f95 ada adb ads pas cr vim tcl awk cmake proto graphql`.split(/\s+/),
);

const CODE_NAMES = new Set(["makefile", "dockerfile", "rakefile", "gemfile", "justfile", "cmakelists.txt", "configure.ac"]);

const THIRD_PARTY = /(^|\/)(node_modules|vendor|vendors|third[_-]?party|thirdparty|external|externals|deps|bower_components|jspm_packages|\.yarn|Pods|Carthage)\//i;
const NOT_THE_CODE = /(^|\/)(docs?|documentation|examples?|samples?|demos?|benchmarks?\/fixtures|fixtures?|testdata|__snapshots__|dist|build|out|target|\.github|\.circleci)\//i;
const GENERATED = /(\.min\.(js|css)|\.bundle\.js|\.pb\.go|_pb2\.py|\.pb\.(cc|h)|\.g\.dart|\.generated\.\w+|\.d\.ts|-lock\.\w+|\.snap)$/i;

export function isThirdParty(path) {
  return THIRD_PARTY.test(path);
}

export function isCode(path) {
  if (isThirdParty(path) || NOT_THE_CODE.test(path) || GENERATED.test(path)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (CODE_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && CODE.has(name.slice(dot + 1));
}
