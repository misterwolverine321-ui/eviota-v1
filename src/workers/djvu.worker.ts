/// <reference lib="webworker" />
/**
 * DjVu worker.
 *
 * Decoding a scanned page takes tens to hundreds of milliseconds, so the `djvu-rs` WebAssembly module
 * lives here and the page thread only asks for results. Requests are answered one at a time, in the
 * order they arrive; pages are numbered from 1 outside this file (the library counts from 0).
 *
 * `djvu-rs` (MIT) picks its own build at start-up: a SIMD one where the browser has it, a scalar one
 * otherwise. Both `.wasm` files come from the npm package and are emitted by the bundler; nothing is
 * fetched from another site.
 */
import init, { WasmDocument } from "djvu-rs";
import { dpiForWidth } from "../lib/djvu";

export type DjvuRequest =
  | { id: number; op: "open"; bytes: ArrayBuffer }
  | { id: number; op: "size"; page: number }
  | { id: number; op: "render"; page: number; width: number }
  | { id: number; op: "text"; page: number }
  | { id: number; op: "close" };

export type DjvuReply =
  | { id: number; ok: true; pageCount: number }
  | { id: number; ok: true; width: number; height: number }
  | { id: number; ok: true; bitmap: ImageBitmap; width: number; height: number }
  | { id: number; ok: true; text: string | null }
  | { id: number; ok: true }
  | { id: number; ok: false; error: string };

let ready: Promise<unknown> | null = null;
let doc: WasmDocument | null = null;

function document_(): WasmDocument {
  if (!doc) throw new Error("No DjVu document is open.");
  return doc;
}

function pageAt(page: number) {
  const d = document_();
  const count = d.page_count();
  if (!Number.isInteger(page) || page < 1 || page > count) {
    throw new Error(`Page ${page} is outside 1 to ${count}.`);
  }
  return d.page(page - 1);
}

async function handle(request: DjvuRequest): Promise<DjvuReply> {
  switch (request.op) {
    case "open": {
      ready ??= init();
      await ready;
      doc?.free();
      doc = null;
      doc = WasmDocument.from_bytes(new Uint8Array(request.bytes));
      return { id: request.id, ok: true, pageCount: doc.page_count() };
    }
    case "size": {
      const page = pageAt(request.page);
      try {
        const dpi = page.dpi();
        return {
          id: request.id,
          ok: true,
          width: page.width_at(dpi),
          height: page.height_at(dpi),
        };
      } finally {
        page.free();
      }
    }
    case "render": {
      const page = pageAt(request.page);
      try {
        const native = page.dpi();
        const dpi = dpiForWidth(
          native,
          page.width_at(native),
          page.height_at(native),
          request.width,
        );
        const width = page.width_at(dpi);
        const height = page.height_at(dpi);
        // `render` hands back bytes owned by JavaScript (a copy made out of the module's memory),
        // so they sit in an ordinary ArrayBuffer; the declaration only says "some ArrayBuffer".
        const pixels = page.render(dpi) as Uint8ClampedArray<ArrayBuffer>;
        const bitmap = await createImageBitmap(new ImageData(pixels, width, height));
        return { id: request.id, ok: true, bitmap, width, height };
      } finally {
        page.free();
      }
    }
    case "text": {
      const page = pageAt(request.page);
      try {
        return { id: request.id, ok: true, text: page.text() ?? null };
      } finally {
        page.free();
      }
    }
    case "close": {
      doc?.free();
      doc = null;
      return { id: request.id, ok: true };
    }
  }
}

/** One request at a time, in arrival order: a render must not be overtaken by a close. */
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<DjvuRequest>) => {
  const request = event.data;
  queue = queue.then(() =>
    handle(request).then(
      (reply) => {
        if ("bitmap" in reply) self.postMessage(reply, [reply.bitmap]);
        else self.postMessage(reply);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ id: request.id, ok: false, error: message } satisfies DjvuReply);
      },
    ),
  );
};
