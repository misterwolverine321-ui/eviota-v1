import { useEffect, useRef, useState } from "react";
import { BookOpen, ExternalLink, Loader2, X } from "lucide-react";
import { isLookupUrl, lookupTerm, wikiLang, type LookupResult } from "@/lib/lookup";
import { grantLookupConsent, hasLookupConsent } from "@/lib/lookup-consent";
import type { ReaderTheme } from "@/lib/reader-settings";
import { requestExternalLink } from "@/lib/safe-report";

export interface DefineRequest {
  term: string;
  /** Viewport rect of the selection the request came from. */
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * Definition card.
 *
 * Positions itself over the reading surface like the selection popover: above
 * the selection when there's room, below it otherwise, always clamped into the
 * viewport. Fetching lives here so the kernel only has to say "define this".
 *
 * This is where a selected word leaves the device, so nothing is requested until the reader has
 * said yes once (kept on this device; Settings can ask again). The word is the only thing sent.
 */
export function DefinitionCard({
  request,
  lang,
  theme,
  onDismiss,
}: {
  request: DefineRequest;
  lang?: string | null;
  theme: ReaderTheme;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [allowed, setAllowed] = useState(hasLookupConsent);
  const [state, setState] = useState<"ask" | "loading" | "done" | "empty">(() =>
    hasLookupConsent() ? "loading" : "ask",
  );
  const site = wikiLang(lang);

  useEffect(() => {
    if (!allowed) {
      setResult(null);
      setState("ask");
      return;
    }
    const controller = new AbortController();
    setState("loading");
    setResult(null);
    void lookupTerm(request.term, { lang: lang ?? null, signal: controller.signal })
      .then((hit) => {
        if (controller.signal.aborted) return;
        setResult(hit);
        setState(hit ? "done" : "empty");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("empty");
      });
    return () => controller.abort();
  }, [request.term, lang, allowed]);

  // Clamp into the viewport once measured (and again when content lands).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const r = request.rect;
    const margin = 8;
    let left = r.x + r.width / 2 - box.width / 2;
    left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, left));
    let top = r.y - box.height - 10;
    if (top < 64) top = Math.min(window.innerHeight - box.height - margin, r.y + r.height + 10);
    setPos({ left, top: Math.max(margin, top) });
  }, [request, state, result]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={state === "ask" ? `Look up ${request.term}?` : `Definition of ${request.term}`}
      className="anim-rise absolute z-40 w-[300px] max-w-[92vw] rounded-[4px] border p-3 shadow-xl"
      style={{
        left: pos?.left ?? request.rect.x,
        top: pos?.top ?? request.rect.y,
        visibility: pos ? "visible" : "hidden",
        background: theme.bg,
        borderColor: theme.line,
        color: theme.ink,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">
            {result?.term ?? request.term}
          </p>
          <p
            className="font-mono text-[11px] tracking-[0.16em] uppercase"
            style={{ color: theme.sub }}
          >
            {state === "ask"
              ? "Nothing sent yet"
              : state === "loading"
                ? "Looking up"
                : result?.source === "wikipedia"
                  ? "Wikipedia"
                  : result
                    ? "Wiktionary"
                    : "No entry"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close definition"
          className="hover:bg-foreground/5 flex h-6 w-6 items-center justify-center rounded-[3px]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 max-h-[40vh] overflow-y-auto">
        {state === "ask" && (
          <div>
            <p className="text-xs leading-relaxed">
              Looking up “{request.term}” sends that word to Wiktionary ({site}.wiktionary.org), and
              to Wikipedia ({site}.wikipedia.org) if Wiktionary has no entry. Wikimedia will see the
              word and your internet address. Nothing else from this book is sent.
            </p>
            <p className="mt-2 text-xs leading-relaxed opacity-60">
              You are asked once. Settings can turn the question back on.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  grantLookupConsent();
                  setAllowed(true);
                }}
                className="bg-signal text-signal-foreground rounded-[3px] px-3 py-1.5 text-xs font-medium"
              >
                Look it up
              </button>
              <button
                type="button"
                autoFocus
                onClick={onDismiss}
                className="rounded-[3px] border px-3 py-1.5 text-xs"
                style={{ borderColor: theme.line }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state === "loading" && (
          <p className="flex items-center gap-2 py-2 text-xs opacity-60">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching dictionary…
          </p>
        )}

        {state === "empty" && (
          <p className="py-2 text-xs leading-relaxed opacity-60">
            No dictionary or encyclopedia entry for “{request.term}”. Check the spelling, or select
            a single word.
          </p>
        )}

        {state === "done" && result?.senses.length ? (
          <ol className="space-y-2">
            {result.senses.map((sense, i) => (
              <li key={i}>
                {sense.partOfSpeech && (
                  <p className="text-[11px] italic" style={{ color: theme.sub }}>
                    {sense.partOfSpeech}
                  </p>
                )}
                <ul className="mt-0.5 space-y-1">
                  {sense.definitions.map((d, j) => (
                    <li key={j} className="text-xs leading-relaxed">
                      <span className="mr-1 font-mono text-[11px] opacity-50">{j + 1}</span>
                      {d}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : null}

        {state === "done" && result?.extract ? (
          <p className="text-xs leading-relaxed">{result.extract}</p>
        ) : null}
      </div>

      {state === "done" && isLookupUrl(result?.url) && (
        <a
          href={result!.url}
          target="_blank"
          rel="noreferrer noopener"
          // The address came from a server's reply. It is checked above and still waits for the
          // same confirmation as a link in a book (left click and middle click alike).
          onClick={(e) => {
            e.preventDefault();
            requestExternalLink(result!.url!, "app");
          }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            requestExternalLink(result!.url!, "app");
          }}
          className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.12em] uppercase"
          style={{ color: theme.sub }}
        >
          Read more <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
