/**
 * Benchmark harness — `window.__eviotaBench`.
 *
 * Reports the three numbers that actually decide whether the reader feels
 * fast: how long a full search index takes to build, how long a query takes
 * once it exists, and how much heap the index costs. It runs entirely on
 * synthetic text so it never touches IndexedDB, a decoder, or a real book.
 *
 * It is not part of the app for everyone: the root route loads it only when the address asks for
 * it. Open `<site>/?bench` (before the `#`), then, in the browser console:
 *   await window.__eviotaBench.run()            // default 500-page corpus
 *   await window.__eviotaBench.run({ pages: 2000, queries: ["fox", "the qui"] })
 *   window.__eviotaBench.heap()
 */

import {
  candidatePages,
  emptyIndex,
  indexPages,
  tokenize,
  type IndexShape,
} from "@/workers/search-index.worker";
import { findMatches } from "@/lib/search";

export interface BenchOptions {
  /** Synthetic pages to index (default 500). */
  pages?: number;
  /** Words per synthetic page (default 300). */
  wordsPerPage?: number;
  /** Queries to time (default a mix of exact, prefix and multi-token). */
  queries?: string[];
  /** Timed repetitions per query (default 20). */
  repeats?: number;
}

export interface QueryTiming {
  query: string;
  /** Median wall-clock ms for candidate resolution + offset scan. */
  medianMs: number;
  p95Ms: number;
  hits: number;
  pages: number;
}

export interface BenchReport {
  pages: number;
  words: number;
  /** Full index build, ms. */
  buildMs: number;
  /** Pages indexed per second. */
  pagesPerSecond: number;
  /** Distinct tokens in the inverted index. */
  terms: number;
  /** Approximate serialized index size, bytes. */
  indexBytes: number;
  tokenizeMsPerMbchar: number;
  queries: QueryTiming[];
  heap: HeapSample | null;
  userAgent: string;
}

export interface HeapSample {
  usedMb: number;
  totalMb: number;
  limitMb: number;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const WORDS = [
  "the",
  "fox",
  "raven",
  "quoth",
  "nevermore",
  "chamber",
  "midnight",
  "dreary",
  "weary",
  "volume",
  "forgotten",
  "lore",
  "nodded",
  "napping",
  "tapping",
  "gently",
  "rapping",
  "visitor",
  "door",
  "muttered",
  "nothing",
  "more",
  "ember",
  "ghost",
  "floor",
  "eagerly",
  "wished",
  "morrow",
  "sorrow",
  "lenore",
  "radiant",
  "maiden",
  "angels",
  "name",
  "silken",
  "uncertain",
  "rustling",
  "purple",
  "curtain",
  "fantastic",
  "terrors",
  "never",
  "felt",
];

/** Deterministic PRNG so consecutive runs are comparable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

function corpus(pages: number, wordsPerPage: number): { page: number; text: string }[] {
  const rand = rng(0xf0110);
  const out: { page: number; text: string }[] = [];
  for (let p = 1; p <= pages; p++) {
    const words: string[] = [];
    for (let w = 0; w < wordsPerPage; w++) words.push(WORDS[Math.floor(rand() * WORDS.length)]);
    // A page-unique marker keeps single-page queries honest.
    words[Math.floor(wordsPerPage / 2)] = `marker${p}`;
    out.push({ page: p, text: words.join(" ") });
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
};
const round = (n: number, digits = 2) => Number(n.toFixed(digits));

export function heap(): HeapSample | null {
  const mem = (
    performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  if (!mem) return null;
  const mb = (b: number) => round(b / 1024 / 1024, 1);
  return {
    usedMb: mb(mem.usedJSHeapSize),
    totalMb: mb(mem.totalJSHeapSize),
    limitMb: mb(mem.jsHeapSizeLimit),
  };
}

export async function run(options: BenchOptions = {}): Promise<BenchReport> {
  const pages = options.pages ?? 500;
  const wordsPerPage = options.wordsPerPage ?? 300;
  const repeats = options.repeats ?? 20;
  const queries = options.queries ?? ["raven", "nevermore", "quoth the raven", "cham", "marker7"];

  const entries = corpus(pages, wordsPerPage);

  // Tokenizer throughput, measured separately from index bookkeeping.
  const sample = entries.slice(0, Math.min(50, entries.length)).map((e) => e.text);
  const chars = sample.reduce((n, t) => n + t.length, 0);
  const tokStart = now();
  for (const text of sample) tokenize(text);
  const tokMs = now() - tokStart;

  const buildStart = now();
  const index: IndexShape = indexPages(emptyIndex(), entries);
  const buildMs = now() - buildStart;

  const timings: QueryTiming[] = [];
  for (const query of queries) {
    const samples: number[] = [];
    let hits = 0;
    let matched = 0;
    for (let i = 0; i < repeats; i++) {
      const t0 = now();
      const candidates = candidatePages(index, query, false);
      let count = 0;
      for (const page of candidates) {
        const text = index.pages[page];
        if (!text) continue;
        count += findMatches(
          text,
          query,
          () => ({ kind: "page" as const, page }),
          `p${page}`,
        ).length;
      }
      samples.push(now() - t0);
      hits = count;
      matched = candidates.length;
    }
    timings.push({
      query,
      medianMs: round(median(samples), 3),
      p95Ms: round(p95(samples), 3),
      hits,
      pages: matched,
    });
    // Yield so a long run never blocks the frame loop.
    await new Promise((r) => setTimeout(r, 0));
  }

  const indexBytes = JSON.stringify(index).length;

  const report: BenchReport = {
    pages,
    words: pages * wordsPerPage,
    buildMs: round(buildMs),
    pagesPerSecond: round(pages / (buildMs / 1000)),
    terms: Object.keys(index.terms).length,
    indexBytes,
    tokenizeMsPerMbchar: round((tokMs / Math.max(1, chars)) * 1_000_000),
    queries: timings,
    heap: heap(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "node",
  };

  if (typeof console !== "undefined") {
    console.info(
      `[eviotaBench] ${pages} pages indexed in ${report.buildMs} ms ` +
        `(${report.pagesPerSecond} pages/s, ${report.terms} terms, ` +
        `${round(indexBytes / 1024 / 1024, 2)} MB index)`,
    );
    console.table(report.queries);
    if (report.heap) console.table([report.heap]);
  }
  return report;
}

export interface EviotaBench {
  run: (options?: BenchOptions) => Promise<BenchReport>;
  heap: () => HeapSample | null;
  version: number;
}

/** Attaches the harness to `window`. Idempotent and safe during SSR. */
export function installBench(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __eviotaBench?: EviotaBench };
  if (w.__eviotaBench) return;
  w.__eviotaBench = { run, heap, version: 1 };
}
