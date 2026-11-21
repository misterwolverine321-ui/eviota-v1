/**
 * Writes public/THIRD_PARTY_NOTICES.txt: what Eviota ships that other people wrote, under which
 * licence, and what could not be established. Run `npm run notices` after changing a dependency
 * or a vendored file, then read the diff.
 *
 * The npm part is not guessed from package.json: the site is built once with source maps into a
 * temporary directory and the packages whose modules ended up in the JavaScript are listed (a
 * build tool in `dependencies` is not shipped and is left out; a transitive dependency that is
 * shipped is put in). The vendored files are described by hand below because nothing in them
 * says where they came from; the SHA-256 printed for each is of the file as it is in the tree, and
 * tests/unit/notices.test.ts fails when a file changes or a new one appears without an entry.
 *
 * This is a record of what the files themselves say, not legal advice. Eviota's own code is under
 * MIT OR Apache-2.0 (my choice, 2026-10-15; LICENSE-MIT, LICENSE-APACHE), except what
 * PART 5 lists.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "THIRD_PARTY_NOTICES.txt");
const read = (p) => readFileSync(join(root, p), "utf8");
const sha256 = (p) =>
  createHash("sha256")
    .update(readFileSync(join(root, p)))
    .digest("hex");

// ------------------------------------------------------------------------ npm packages
function bundledPackageNames() {
  const out = mkdtempSync(join(tmpdir(), "eviota-notices-"));
  try {
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--sourcemap",
        "--outDir",
        out,
        "--emptyOutDir",
      ],
      { cwd: root, stdio: "ignore" },
    );
    const names = new Set();
    const assets = join(out, "assets");
    for (const f of readdirSync(assets).filter((f) => f.endsWith(".map"))) {
      const { sources = [] } = JSON.parse(readFileSync(join(assets, f), "utf8"));
      for (const s of sources) {
        const all = [...s.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
        if (all.length) names.add(all[all.length - 1][1]);
      }
    }
    return [...names].sort();
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// A line that names a holder: 'Copyright 2016 …', 'Copyright (c) …', '(c) 2014 …' or '© …' (not a
// sentence of a licence that happens to start with the word, such as 'copyright statement(s).').
const COPYRIGHT = /^\s*(?:copyright\s*(?:\(c\)|©)|copyright\s+\d|\(c\)\s*\d|©).*$/i;
const FILE_RE = /^(licen[sc]e|licen[sc]ing|copying)/i;

function packageInfo(name) {
  const dir = join(root, "node_modules", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  let license = pkg.license ?? pkg.licenses?.map((l) => l.type).join(" OR ") ?? "(none declared)";
  if (typeof license === "object") license = license.type;
  const files = readdirSync(dir).filter((f) => FILE_RE.test(f) && statSync(join(dir, f)).isFile());
  const notices = readdirSync(dir).filter((f) => /^notice/i.test(f));
  const text = files.length
    ? readFileSync(join(dir, files[0]), "utf8").replace(/\r\n/g, "\n")
    : null;
  const copyright = text
    ? text
        .split("\n")
        .filter((l) => COPYRIGHT.test(l))
        .map((l) => l.trim())
        .slice(0, 4)
    : [];
  const author = typeof pkg.author === "string" ? pkg.author : (pkg.author?.name ?? null);
  return { name, version: pkg.version, license, text, copyright, notices, author, dir };
}

/** The licence text with the lines that name a copyright holder taken out, for grouping. */
const shape = (text) =>
  text
    .split("\n")
    .filter((l) => !COPYRIGHT.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// ---------------------------------------------------------------------- vendored files
const VENDORED = [
  {
    file: "public/vendor/libarchive/worker-bundle.js",
    what: "libarchive.js 2.0.2 worker (opens CBR/CB7 and other archives).",
    licence: "MIT (libarchive.js, Copyright (c) 2018 ნიკა); Apache-2.0 (Comlink)",
    lines: [
      "Byte-identical to node_modules/libarchive.js/dist/worker-bundle.js (checked by hash).",
      "Its header: '@license Copyright 2019 Google LLC, SPDX-License-Identifier: Apache-2.0' (Comlink).",
    ],
  },
  {
    file: "public/vendor/libarchive/libarchive.wasm",
    what: "libarchive 3.7.2 compiled to WebAssembly, as shipped in libarchive.js 2.0.2.",
    licence: "NOT ESTABLISHED for everything inside (see below)",
    lines: [
      "Byte-identical to node_modules/libarchive.js/src/webworker/wasm-gen/libarchive.wasm (hash).",
      "The text inside the file names 'libarchive 3.7.2'. libarchive is, to the best of the maintainer's",
      "knowledge, under the 2-clause BSD licence; that was NOT verified here.",
      "Strings inside the binary show it also contains code from bzip2 (libbzip2), xz (liblzma), zlib,",
      "BLAKE2, and OpenSSL libcrypto (source file names such as evp_enc.c and a_bitstr.c, and the",
      "message 'OpenSSL internal error, assertion failed'). The OpenSSL VERSION could not be",
      "determined from the file, and the OpenSSL licence differs by version (releases before 3.0 use",
      "the OpenSSL and SSLeay licences, which carry an advertising clause; 3.0 and later use",
      "Apache-2.0). The libarchive.js package ships no notices for these libraries. The notices that",
      "belong to this file are therefore INCOMPLETE until its build recipe is found or it is rebuilt",
      "from known sources.",
      "At the maintainer's request (2026-10-15), PART 7 reproduces the OpenSSL project's licence file for",
      "both branches as a fallback; it is a notice, not a finding of which one applies.",
    ],
  },
  {
    file: "public/vendor/tesseract/worker.min.js",
    what: "tesseract.js 6.0.1 worker (OCR).",
    licence: "Apache-2.0 (tesseract.js); MIT and BSD-3-Clause parts, listed below",
    lines: [
      "Byte-identical to node_modules/tesseract.js/dist/worker.min.js (hash). The file points to a",
      "worker.min.js.LICENSE.txt that is not copied next to it; the package's copy lists, for code",
      "inside the file: buffer (MIT, Feross Aboukhadijeh), ieee754 (BSD-3-Clause, Feross",
      "Aboukhadijeh), regenerator-runtime (MIT, Copyright (c) 2014-present Facebook, Inc.) and",
      "zlib.js (MIT, imaya, 2012).",
    ],
  },
  {
    file: "public/vendor/tesseract/tesseract-core-lstm.wasm.js",
    what: "tesseract.js-core 6.0.0 (Tesseract OCR engine compiled to WebAssembly).",
    licence: "Apache-2.0 (as declared by tesseract.js-core); contents NOT inspected",
    lines: [
      "Byte-identical to node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js (hash).",
      "The engine is built from Tesseract (Apache-2.0) with Leptonica and other libraries and the",
      "Emscripten runtime; which libraries and under which notices was NOT inspected.",
    ],
  },
  {
    file: "public/vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
    what: "tesseract.js-core 6.0.0, SIMD build.",
    licence: "Apache-2.0 (as declared by tesseract.js-core); contents NOT inspected",
    lines: [
      "Byte-identical to node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js (hash).",
    ],
  },
  {
    file: "public/vendor/tesseract/eng.traineddata",
    what: "English OCR model.",
    licence: "Apache-2.0",
    lines: [
      "Byte-identical to eng.traineddata on the main branch of github.com/tesseract-ocr/tessdata_fast,",
      "fetched 2026-10-14 (SHA-256 below). That repository's LICENSE file is the Apache License 2.0.",
    ],
  },
];

const FONT_PACKAGES = [
  "@fontsource-variable/inter",
  "@fontsource-variable/inter-tight",
  "@fontsource-variable/jetbrains-mono",
  "@fontsource-variable/lora",
];

// -------------------------------------------------------------------------- the text
const wrap = (s, width = 98, indent = "") => {
  const words = s.split(/\s+/);
  const lines = [];
  let line = indent;
  for (const w of words) {
    if ((line + " " + w).trim().length > width && line.trim()) {
      lines.push(line);
      line = indent + w;
    } else line = line.trim() ? line + " " + w : indent + w;
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
};

const rule = (title) => `\n${"=".repeat(100)}\n${title}\n${"=".repeat(100)}\n`;

function build() {
  const names = bundledPackageNames();
  const infos = names.map(packageInfo);
  const parts = [];

  parts.push("EVIOTA - THIRD-PARTY NOTICES");
  parts.push(
    wrap(
      "Generated by scripts/make-notices.mjs on " +
        new Date().toISOString().slice(0, 10) +
        ". This file lists what Eviota ships that other people wrote, the licence each file or package states for itself, and what could not be established. It records what the files say; it is not legal advice. Eviota's own code is under MIT OR Apache-2.0, as the maintainer chose it on 2026-10-15 (files LICENSE-MIT and LICENSE-APACHE), except for what PART 5 lists; everything else here keeps the licence its author gave it.",
    ),
  );

  // PART 1 ------------------------------------------------------------------------------------
  parts.push(rule("PART 1 - FILES COPIED INTO public/vendor"));
  for (const v of VENDORED) {
    parts.push(
      `${v.file}\n  SHA-256 ${sha256(v.file)}  (${statSync(join(root, v.file)).size} bytes)`,
    );
    parts.push(wrap(v.what, 98, "  "));
    parts.push(`  Licence: ${v.licence}`);
    parts.push(v.lines.map((l) => "  " + l).join("\n"));
    parts.push("");
  }

  // PART 2 ------------------------------------------------------------------------------------
  parts.push(rule("PART 2 - FONTS (SIL Open Font License 1.1; the text is in PART 4)"));
  parts.push(
    wrap(
      "The interface fonts are bundled from the @fontsource-variable packages, unmodified. A book's own text is not set in them.",
    ),
  );
  for (const n of FONT_PACKAGES) {
    const i = packageInfo(n);
    parts.push(`${i.name}@${i.version}  ${i.license}`);
    for (const c of i.copyright.slice(0, 2)) parts.push("  " + c);
  }

  // PART 3 ------------------------------------------------------------------------------------
  parts.push(rule(`PART 3 - npm PACKAGES IN THE BUILT JavaScript (${infos.length})`));
  parts.push(
    wrap(
      "Packages with at least one module in the built JavaScript (source-map check; see the top of scripts/make-notices.mjs). Build tools, test tools and anything not shipped are left out. Each line: name@version, the licence the package declares, and the copyright lines found in its licence file. The licence texts are in PART 4, grouped.",
    ),
  );
  parts.push("");
  for (const i of infos) {
    parts.push(`${i.name}@${i.version}  ${i.license}`);
    if (i.copyright.length) for (const c of i.copyright) parts.push("  " + c);
    else
      parts.push(
        `  (no licence file in the package; declared in package.json${i.author ? `, author: ${i.author}` : ""})`,
      );
  }

  // PART 4 ------------------------------------------------------------------------------------
  parts.push(
    rule(
      "PART 4 - LICENCE TEXTS (each distinct text once; the copyright lines are in PARTS 2 and 3)",
    ),
  );
  const groups = new Map();
  for (const i of [...FONT_PACKAGES.map(packageInfo), ...infos]) {
    if (!i.text) continue;
    const key = shape(i.text);
    if (!groups.has(key)) groups.set(key, { text: i.text, who: [] });
    groups.get(key).who.push(`${i.name}@${i.version}`);
  }
  const withNotice = [...FONT_PACKAGES.map(packageInfo), ...infos].filter((i) => i.notices.length);
  let n = 0;
  for (const g of groups.values()) {
    n++;
    parts.push(`--- Text ${n}, as shipped by: ${g.who.join(", ")}`);
    parts.push(g.text.trim());
    parts.push("");
  }
  for (const i of withNotice) {
    parts.push(`--- NOTICE file of ${i.name}@${i.version}`);
    for (const f of i.notices) parts.push(readFileSync(join(i.dir, f), "utf8").trim());
    parts.push("");
  }
  // Licences whose text is not in an installed package.
  parts.push(
    "--- BSD 3-Clause, as published for zip.js (foliate-js vendors a build of zip.js in `foliate-js/vendor/zip.js`,",
  );
  parts.push(
    "    which says in its README that it is BSD-3-Clause; the vendored copy carries no header, so the text and",
  );
  parts.push(
    "    the copyright holder below come from zip.js 2.23.0's LICENSE and may differ in year from the build used)",
  );
  parts.push(read("scripts/notices/zip.js-BSD-3-Clause.txt").trim());
  parts.push("");

  // PART 5 ------------------------------------------------------------------------------------
  const uiFiles = readdirSync(join(root, "src/components/ui")).filter((f) => f.endsWith(".tsx"));
  parts.push(rule("PART 5 - SOURCE IN THIS REPOSITORY THAT IS NOT EVIOTA'S OWN"));
  parts.push(
    [
      wrap(
        `src/components/ui/ (${uiFiles.length} files, *.tsx): shadcn/ui components. The shadcn command-line tool generates them into the repository (see components.json: style "new-york"), and the files carry no header of their own. shadcn/ui is under the MIT licence, Copyright (c) 2023 shadcn (LICENSE.md in github.com/shadcn-ui/ui, read 2026-10-15; the text follows). Whether and how each file was changed after it was generated was NOT compared. src/lib/utils.ts and src/hooks/use-mobile.tsx look like the generator's usual helpers; that was NOT compared either.`,
        98,
        "  ",
      ),
      "",
      read("scripts/notices/shadcn-ui-LICENSE.txt")
        .trim()
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    ].join("\n"),
  );
  parts.push("");

  // PART 6 ------------------------------------------------------------------------------------
  parts.push(
    rule(
      "PART 6 - OTHER ASSETS (rights not established by the files; the maintainer's decision recorded)",
    ),
  );
  parts.push(
    [
      wrap(
        "public/samples/*.epub: three short excerpts, written out by scripts/make-samples.mjs, of Alice's Adventures in Wonderland (Lewis Carroll, died 1898), The Tell-Tale Heart (Edgar Allan Poe, died 1849) and Walden (Henry David Thoreau, died 1862). By their authors' death dates the works should be in the public domain in the United States and where copyright lasts for life plus 70 years or less (reasoned from the dates, not checked against any country's law). The edition the excerpts were taken from is NOT recorded, and the wording was not compared with one.",
        98,
        "  ",
      ),
      "",
      wrap(
        "src/assets/covers/*.jpg and the covers inside the sample EPUBs: drawn by scripts/covers/make_covers.py on 2026-10-26 from the Lora and Inter Tight outlines (both SIL OFL-1.1) and the project's own colours, so they are the project's own work. They are real JPEG files with no embedded metadata. They replaced three earlier images that carried a generator's metadata tag; those images are no longer in the repository.",
        98,
        "  ",
      ),
      "",
      readdirSync(join(root, "src/assets/covers"))
        .sort()
        .map((f) => `    src/assets/covers/${f}\n      SHA-256 ${sha256(`src/assets/covers/${f}`)}`)
        .join("\n"),
      "",
      wrap(
        "brand/, public/favicon.*, public/icons/: the first page-with-fold concept was SVG code that an outside tool drew at the maintainer's request. The approved logo was rebuilt by scripts/brand/make_brand.py from its own geometry (an E cut out of the page, approved by the maintainer on 2026-10-26) and the Inter Tight and JetBrains Mono fonts (OFL-1.1). The terms of that tool and what the law says about rights in the concept were NOT checked here.",
        98,
        "  ",
      ),
      "",
      wrap(
        "MAINTAINER'S DECISION, 2026-10-15: the maintainer confirmed and authorised the redistribution of the logo concept described above for this open-source release, and asked for it to be recorded as cleared for redistribution under the project's baseline terms. It is recorded here as cleared by that decision. This is the maintainer's statement, written down as given: it is not an independent finding, and nothing in the files above was checked to support it. The project's baseline terms are MIT OR Apache-2.0, chosen by the maintainer on 2026-10-15 (LICENSE-MIT, LICENSE-APACHE); whether those terms can validly apply to the logo concept was NOT checked here.",
        98,
        "  ",
      ),
    ].join("\n"),
  );
  parts.push("");

  // PART 7 ------------------------------------------------------------------------------------
  parts.push(
    rule("PART 7 - OPENSSL FALLBACK NOTICE (for public/vendor/libarchive/libarchive.wasm)"),
  );
  parts.push(
    [
      wrap(
        "The OpenSSL version inside public/vendor/libarchive/libarchive.wasm could not be determined (see its entry in PART 1), and the OpenSSL project's licence differs by branch. This part reproduces, unmodified, the licence file of each branch, so that whichever one applies to the build is present with the app. It was added at the maintainer's request on 2026-10-15. It is a notice, not a finding: it does not say which branch the file was built from, what either licence requires of Eviota, or that those requirements are met.",
      ),
      "",
      wrap(
        "What the binary shows: besides libarchive's own code it contains OpenSSL source file names such as mem_dbg.c. In the OpenSSL repository on GitHub, crypto/mem_dbg.c exists in the tag OpenSSL_1_1_1w and does not exist in the tag openssl-3.0.15 (looked up 2026-10-15 for all 27 OpenSSL source names found in the binary: mem_dbg.c is the only one missing from openssl-3.0.15, the other 26 exist in both tags). That leans toward the 1.1.x line and proves nothing about the exact version, so both branches are given.",
      ),
      "",
      "--- OpenSSL 1.1.1 and earlier: dual licence, the OpenSSL License and the original SSLeay License",
      `    (file LICENSE of the tag OpenSSL_1_1_1w, https://github.com/openssl/openssl; SHA-256 of the copy below: ${sha256("scripts/notices/OpenSSL-1.1.1w-LICENSE.txt")})`,
      "",
      read("scripts/notices/OpenSSL-1.1.1w-LICENSE.txt")
        .replace(/\r\n/g, "\n")
        .replace(/^\n+/, "")
        .trimEnd(),
      "",
      "--- OpenSSL 3.x: Apache License 2.0",
      `    (file LICENSE.txt of the tags openssl-3.0.15 and openssl-3.3.2, which are identical; SHA-256 of the copy below: ${sha256("scripts/notices/OpenSSL-3.x-Apache-2.0.txt")})`,
      "",
      read("scripts/notices/OpenSSL-3.x-Apache-2.0.txt")
        .replace(/\r\n/g, "\n")
        .replace(/^\n+/, "")
        .trimEnd(),
    ].join("\n"),
  );
  parts.push("");

  // PART 8 ------------------------------------------------------------------------------------
  const djvuNoticePath = "node_modules/djvu-rs/THIRD_PARTY_NOTICES";
  const djvuNotice = read(djvuNoticePath).replace(/\r\n/g, "\n").trim();
  const djvuPackage = JSON.parse(read("node_modules/djvu-rs/package.json"));
  const djvuCrates = /^Crates \((\d+)\):/m.exec(djvuNotice)?.[1] ?? "an unknown number of";
  const blankHolders = djvuNotice
    .split(/^-{80}$/m)
    .filter((block) => block.includes("<year> <copyright holders>"))
    .flatMap((block) =>
      [...block.matchAll(/^\s+- (\S+) (\S+) \(/gm)].map((m) => `${m[1]} ${m[2]}`),
    );
  parts.push(
    rule("PART 8 - THE RUST CRATES INSIDE djvu-rs's WebAssembly (the package's own notice)"),
  );
  parts.push(
    [
      wrap(
        `DjVu files are decoded by the npm package djvu-rs ${djvuPackage.version} (licence field: ${djvuPackage.license}; it is listed with its copyright line in PART 3). Its two WebAssembly files, scalar/djvu_rs_bg.wasm and simd128/djvu_rs_bg.wasm, are built from Rust and link ${djvuCrates} crates statically. The package ships a notice for them, node_modules/djvu-rs/THIRD_PARTY_NOTICES (SHA-256 ${sha256(djvuNoticePath)}). It is reproduced below exactly as the package has it, below the line of equals signs; nothing in it was changed, and nothing in it was written by Eviota.`,
        98,
        "  ",
      ),
      "",
      wrap(
        "WHAT EVIOTA HAS NOT CHECKED: every statement in this part, including any statement about the licences or history of the crates, is the package's own, reproduced as the package has it. Eviota has not checked those statements against the crates' source code, the repository's history or the build, and it does not repeat or vouch for any correspondence with the package's authors.",
        98,
        "  ",
      ),
      "",
      wrap(
        blankHolders.length
          ? `WHAT IS INCOMPLETE IN IT: one licence text in the package's notice, shared by ${blankHolders.length} of its crates (${blankHolders.join(", ")}), has the placeholder "Copyright (c) <year> <copyright holders>" where the holders' names would be. It is left as the package has it.`
          : "No licence text in the package's notice has an unfilled copyright placeholder.",
        98,
        "  ",
      ),
      "",
      wrap(
        "NOT ESTABLISHED BY EVIOTA: the history of the djvu-rs repository, including any code removed from it earlier; whether the list is complete for every build of the package other than this version; patents; and any legal conclusion. Assurance of that kind would need a legal review, and none has been carried out.",
        98,
        "  ",
      ),
      "",
      "=".repeat(100),
      "",
      djvuNotice,
    ].join("\n"),
  );
  parts.push("");

  const text = parts.join("\n") + "\n";
  writeFileSync(OUT, text);
  console.log(`wrote ${relative(root, OUT)}: ${infos.length} packages, ${text.length} characters`);
}

if (!existsSync(join(root, "node_modules/vite/bin/vite.js"))) {
  console.error("run npm ci first");
  process.exit(1);
}
build();
