// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * public/THIRD_PARTY_NOTICES.txt is written by `npm run notices` and says, for every file copied
 * into public/vendor and for the cover images, which file it describes (by SHA-256) and what could
 * and could not be established about its licence. These tests do not judge the licences; they fail
 * when the files and the notices stop describing the same things: a vendored file changed or was
 * added without an entry, an npm package is listed at a version the lockfile no longer has, or the
 * source that is not Eviota's own (shadcn/ui) stops being described.
 */

const root = join(__dirname, "..", "..");
const notices = readFileSync(join(root, "public", "THIRD_PARTY_NOTICES.txt"), "utf8");
const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");

function filesUnder(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path];
  });
}

const part = (from: string, to: string | null) => {
  const start = notices.indexOf(from);
  expect(start, `${from} is in the notices`).toBeGreaterThan(-1);
  const end = to ? notices.indexOf(to, start) : notices.length;
  expect(end, `${to} follows ${from}`).toBeGreaterThan(start);
  return notices.slice(start, end);
};

describe("third-party notices", () => {
  it("describes every file under public/vendor, by the hash of the file as it is", () => {
    const files = filesUnder("public/vendor");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(notices, `${file} (changed, or added without an entry?)`).toContain(
        `${file}\n  SHA-256 ${sha256(file)}`,
      );
    }
  });

  it("has no entry for a vendored file that is gone", () => {
    const listed = [...notices.matchAll(/^(public\/vendor\/\S+)$/gm)].map((m) => m[1]!);
    expect(listed.length).toBeGreaterThan(0);
    for (const file of listed) expect(existsSync(join(root, file)), file).toBe(true);
  });

  it("pins the cover images by hash", () => {
    const covers = filesUnder("src/assets/covers");
    expect(covers.length).toBe(3);
    for (const file of covers) {
      expect(notices, `${file} (replaced without reviewing the notice?)`).toContain(
        `${file}\n      SHA-256 ${sha256(file)}`,
      );
    }
  });

  it("lists each npm package at the version the lockfile has, and says how many there are", () => {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    const body = part("PART 3 - npm PACKAGES", "PART 4 - LICENCE TEXTS");
    const declared = Number(/BUILT JavaScript \((\d+)\)/.exec(body)?.[1]);
    const rows = [...body.matchAll(/^(@?[^\s@]+(?:\/[^\s@]+)?)@(\S+) {2}(.+)$/gm)];
    expect(rows.length).toBe(declared);
    expect(rows.length).toBeGreaterThan(40);
    for (const [, name, version] of rows) {
      expect(lock.packages[`node_modules/${name}`]?.version, `${name} in package-lock.json`).toBe(
        version,
      );
    }
  });

  it("describes the source that is not Eviota's own, and does not claim it for the project licence", () => {
    const entry = part("PART 5 -", "PART 6 -");
    // shadcn/ui: the real upstream licence text, and the number of files it names is the number there are.
    const mit = readFileSync(
      join(root, "scripts", "notices", "shadcn-ui-LICENSE.txt"),
      "utf8",
    ).trim();
    expect(mit).toContain("Copyright (c) 2023 shadcn");
    for (const line of mit.split("\n")) expect(entry).toContain(line.trim());
    const ui = readdirSync(join(root, "src", "components", "ui")).filter((f) => f.endsWith(".tsx"));
    expect(ui.length).toBeGreaterThan(0);
    expect(entry).toContain(`src/components/ui/ (${ui.length} files, *.tsx)`);
    // The CHM decoder that used to be listed here is gone; nothing is left to describe.
    expect(entry).not.toContain("src/lib/chm");
    expect(entry).not.toContain("CHMLib");
  });

  it("states the project's own licence as the maintainer chose it, and ships both licence files", () => {
    expect(notices).toContain("MIT OR Apache-2.0");
    const mit = readFileSync(join(root, "LICENSE-MIT"), "utf8");
    expect(mit).toContain("Copyright (c) 2026 Eviota Contributors");
    expect(mit).toContain("Permission is hereby granted, free of charge");
    const apache = readFileSync(join(root, "LICENSE-APACHE"), "utf8");
    expect(apache).toContain(
      "Apache License\n                           Version 2.0, January 2004",
    );
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      license?: string;
    };
    expect(pkg.license).toBe("MIT OR Apache-2.0");
  });

  it("no longer carries DjVu.js or its GPL text", () => {
    expect(existsSync(join(root, "public", "vendor", "djvu"))).toBe(false);
    expect(notices).not.toContain("GNU GENERAL PUBLIC LICENSE");
    expect(notices).not.toContain("public/vendor/djvu");
  });

  it("does not carry the CHM decoder that was removed, in a path or in a header", () => {
    // The decoder was, by its own header, a port of GPL-2.0-or-later code. Bringing CHM back is my
    // decision (a permissively licensed decoder, checked against a real .chm); until then
    // neither the files nor the words that named their source may be in the source tree.
    expect(existsSync(join(root, "src", "lib", "chm"))).toBe(false);
    expect(existsSync(join(root, "src", "lib", "chm.ts"))).toBe(false);
    expect(existsSync(join(root, "src", "components", "reader", "chm-reader.tsx"))).toBe(false);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|css)$/.test(entry.name)) {
          if (/cabextract|CHMLib|chm_lib|lzx\.c\b/i.test(readFileSync(path, "utf8")))
            found.push(path.slice(root.length + 1));
        }
      }
    };
    walk(join(root, "src"));
    expect(found).toEqual([]);
  });

  it("pins djvu-rs exactly and reproduces the package's own notice unchanged", () => {
    const entry = part("PART 8 -", null);
    const dir = join(root, "node_modules", "djvu-rs");
    const version = (
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }
    ).version;
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies["djvu-rs"], "an exact version, not a range").toBe(version);
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };
    expect(lock.packages["node_modules/djvu-rs"]?.version).toBe(version);
    expect(lock.packages["node_modules/djvu-rs"]?.integrity).toMatch(/^sha512-/);

    // The package's notice, character for character (the generator only normalises line endings).
    const theirs = readFileSync(join(dir, "THIRD_PARTY_NOTICES"), "utf8")
      .replace(/\r\n/g, "\n")
      .trim();
    expect(theirs.length).toBeGreaterThan(5000);
    expect(entry, "the package's notice, unchanged").toContain(theirs);
    expect(entry, "pinned by the hash of the file").toContain(
      sha256("node_modules/djvu-rs/THIRD_PARTY_NOTICES"),
    );
    expect(entry).toContain(`djvu-rs ${version}`);
  });

  it("reproduces the djvu-rs notice and says what Eviota has not checked, without repeating correspondence", () => {
    const entry = part("PART 8 -", null).replace(/\s+/g, " ");
    expect(entry).toContain("WHAT EVIOTA HAS NOT CHECKED");
    expect(entry).toContain("does not repeat or vouch for any correspondence");
    // The paraphrase of a third party's reply, and the working notes around it, stay out.
    expect(entry).not.toMatch(/screenshot|issue #949|pull request #95|cos-djvu|Nawiri/);
    expect(entry).toContain("NOT ESTABLISHED BY EVIOTA");
    expect(entry).toContain("any legal conclusion");
    // The unfilled copyright placeholder is flagged, with every crate that shares the text.
    const theirs = readFileSync(
      join(root, "node_modules", "djvu-rs", "THIRD_PARTY_NOTICES"),
      "utf8",
    );
    expect(theirs).toContain("<year> <copyright holders>");
    const block = theirs.split(/^-{80}$/m).find((b) => b.includes("<year> <copyright holders>"))!;
    const users = [...block.matchAll(/^\s+- (\S+) (\S+) \(/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(users.length).toBeGreaterThan(0);
    expect(entry).toContain("WHAT IS INCOMPLETE IN IT");
    for (const user of users)
      expect(entry, `${user} is named as having the placeholder`).toContain(user);
  });

  it("says out loud what it could not establish", () => {
    expect(notices).toContain("INCOMPLETE");
    expect(notices).toContain("The OpenSSL VERSION could not be");
    expect(notices).toContain("Licence: NOT ESTABLISHED for everything inside");
    expect(notices).toContain("contents NOT inspected");
    expect(notices).toContain("were NOT checked here");
  });

  it("carries both OpenSSL licence texts, whole, as a fallback that claims nothing", () => {
    const fallback = part("PART 7 -", "PART 8 -");
    for (const file of ["OpenSSL-1.1.1w-LICENSE.txt", "OpenSSL-3.x-Apache-2.0.txt"]) {
      const text = readFileSync(join(root, "scripts", "notices", file), "utf8")
        .replace(/\r\n/g, "\n")
        .replace(/^\n+/, "")
        .trimEnd();
      expect(fallback, `${file} is reproduced unmodified`).toContain(text);
      expect(fallback, `${file} is pinned by hash`).toContain(sha256(`scripts/notices/${file}`));
    }
    expect(fallback).toContain(
      "both the conditions of\n  the OpenSSL License and the original SSLeay license apply",
    );
    expect(fallback).toContain(
      "Apache License\n                           Version 2.0, January 2004",
    );
    // It says what it is and what it is not.
    expect(fallback.replace(/\s+/g, " ")).toContain("It is a notice, not a finding");
    // The notice is wrapped, so a phrase can cross a line break: compare with spaces.
    expect(fallback.replace(/\s+/g, " ")).toContain(
      "does not say which branch the file was built from",
    );
    // The file's own entry points to it and still says its notices are incomplete.
    const entry = part(
      "public/vendor/libarchive/libarchive.wasm\n",
      "public/vendor/tesseract/worker.min.js",
    );
    expect(entry).toContain("PART 7");
    expect(entry).toContain("INCOMPLETE");
  });

  it("records the maintainer's decision about the logo concept as theirs, not as a finding", () => {
    // The notice is wrapped at 98 columns, so a phrase can cross a line break: compare with spaces.
    const assets = part("PART 6 -", "PART 7 -").replace(/\s+/g, " ");
    expect(assets).toContain("MAINTAINER'S DECISION, 2026-10-15");
    expect(assets).toContain("the maintainer confirmed and authorised");
    expect(assets).toContain("it is not an independent finding");
    expect(assets).toContain("baseline terms are MIT OR Apache-2.0");
    expect(assets).toContain("was NOT checked here");
    // The covers are the project's own drawings now: the entry names the script that draws them.
    expect(assets).toContain("drawn by scripts/covers/make_covers.py");
  });

  it("speaks in the maintainer's voice, not the first person, where the notice itself writes", () => {
    // Phrases from the first-person drafts this notice had. The whole file is searched, the
    // reproduced licence texts included: none of these phrases occurs in them.
    expect(notices).not.toMatch(
      /my screenshot|as I chose|approved by me|by me on|at my request|for me at|I confirmed|I plan to|MY DECISION|a lawyer's review/,
    );
  });
});
