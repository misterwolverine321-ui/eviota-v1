import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import {
  COMIC_FITS,
  FONT_STACKS,
  READER_THEMES,
  type ReaderSettings,
  type ReaderTheme,
  type RendererCaps,
} from "@/lib/reader-settings";
import { resolvePdfInvert, type ResolvedReaderTheme } from "@/lib/reader-theme-resolve";
import { clampRate, TTS_RATE_STEP } from "@/lib/tts";
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN, SCROLL_SPEED_STEP } from "@/hooks/use-auto-scroll";
import { ENCODINGS, encodingName } from "@/lib/text-decode";
import { cn } from "@/lib/utils";
import { Group, Segments, Stepper } from "../ui";

/** The slice of the TTS controller the Display tab drives. */
export interface ReadAloudApi {
  supported: boolean;
  active: boolean;
  paused: boolean;
  loading: boolean;
  voices: { name: string; lang: string }[];
  toggle: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
}

/** The slice of the auto-scroll controller the Display tab drives. */
export interface AutoScrollApi {
  running: boolean;
  toggle: () => void;
}

/** Display tab: theme, typography, flow, zoom, spread — all capability-gated. */
export function DisplayTab({
  settings,
  caps,
  theme,
  update,
  onEncoding,
  cleanView,
  onCleanView,
  ocrEnabled,
  onOcrEnabled,
  sharpZoom,
  onSharpZoom,
  sharpAmount,
  onSharpAmount,
  tts,
  autoScroll,
}: {
  settings: ReaderSettings;
  caps: RendererCaps;
  theme: ReaderTheme;
  update: (patch: Partial<ReaderSettings>) => void;
  onEncoding?: (label: string) => void;
  cleanView?: boolean;
  onCleanView?: (next: boolean) => void;
  ocrEnabled?: boolean;
  onOcrEnabled?: (next: boolean) => void;
  /**
   * Phase 15.5: per-book sharp-zoom override for image books. `undefined`
   * means this book follows the global setting.
   */
  sharpZoom?: boolean;
  onSharpZoom?: (next: boolean | undefined) => void;
  sharpAmount?: number;
  onSharpAmount?: (next: number | undefined) => void;
  /** Phase 12: read-aloud controls, present when the engine declares `tts`. */
  tts?: ReadAloudApi;
  /** Phase 12: hands-free scrolling, present when the engine declares it. */
  autoScroll?: AutoScrollApi;
}) {
  /** Effective sharp-zoom state for this book: override first, global next. */
  const sharpOn = sharpZoom ?? settings.enhance;
  /**
   * What the PDF actually does right now: an explicit choice wins, otherwise it
   * follows the resolved reading theme. `theme.id` is already resolved (never
   * "match"), so this is the same value the renderer receives.
   */
  const nightScan = resolvePdfInvert(settings.pdfInvert, theme.id as ResolvedReaderTheme);
  const sharpStrength = sharpAmount ?? settings.enhanceAmount;
  const perBook = !!onSharpZoom && !!onSharpAmount;

  return (
    <>
      <Group label="Theme">
        <div className="flex gap-2">
          {READER_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => update({ theme: t.id })}
              aria-pressed={settings.theme === t.id}
              className={cn(
                "flex-1 rounded-[3px] border px-2 py-2 text-xs font-medium transition-all pointer-coarse:min-h-11",
                settings.theme === t.id && "ring-2 ring-signal",
              )}
              style={
                t.id === "match"
                  ? { borderColor: t.line }
                  : { background: t.bg, color: t.ink, borderColor: t.line }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </Group>

      {/* Phase 12 — read aloud. The engine declares `tts`; the hook reports
          whether this browser actually has speech synthesis. */}
      {caps.tts && tts?.supported && (
        <Group label="Read aloud">
          <div
            className="flex items-center gap-1 rounded-[3px] border p-1"
            style={{ borderColor: theme.line }}
          >
            <button
              type="button"
              onClick={tts.prev}
              aria-label="Previous sentence"
              className="rounded-[2px] px-2 py-1.5 transition-opacity hover:opacity-60 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={tts.toggle}
              className="flex flex-1 items-center justify-center gap-2 rounded-[2px] px-2 py-1.5 text-xs font-medium transition-opacity hover:opacity-60 pointer-coarse:min-h-11"
            >
              {tts.active && !tts.paused ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {tts.loading ? "Loading…" : tts.active && !tts.paused ? "Pause" : "Play"}
              <span className="sr-only"> read aloud</span>
            </button>
            <button
              type="button"
              onClick={tts.next}
              aria-label="Next sentence"
              className="rounded-[2px] px-2 py-1.5 transition-opacity hover:opacity-60 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            {tts.active && (
              <button
                type="button"
                onClick={tts.stop}
                aria-label="Stop reading"
                className="rounded-[2px] px-2 py-1.5 transition-opacity hover:opacity-60 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="mt-2">
            <Stepper
              label="Speed"
              value={`${settings.ttsRate.toFixed(2)}×`}
              theme={theme}
              onDec={() => update({ ttsRate: clampRate(settings.ttsRate - TTS_RATE_STEP) })}
              onInc={() => update({ ttsRate: clampRate(settings.ttsRate + TTS_RATE_STEP) })}
              onReset={() => update({ ttsRate: 1 })}
            />
          </div>

          {tts.voices.length > 0 && (
            <select
              value={settings.ttsVoice ?? ""}
              onChange={(e) => update({ ttsVoice: e.target.value || null })}
              aria-label="Voice"
              className="w-full rounded-[3px] border bg-transparent px-2 py-1.5 text-xs"
              style={{ borderColor: theme.line, color: theme.ink }}
            >
              <option value="">Automatic</option>
              {tts.voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          )}
        </Group>
      )}

      {/* Phase 12 — hands-free scrolling. */}
      {caps.autoScroll && autoScroll && (
        <Group label="Auto-scroll">
          <button
            type="button"
            onClick={autoScroll.toggle}
            className="w-full rounded-[3px] border px-2 py-1.5 text-xs font-medium transition-opacity hover:opacity-60 pointer-coarse:min-h-11"
            style={{
              borderColor: theme.line,
              ...(autoScroll.running ? { background: theme.line } : null),
            }}
          >
            {autoScroll.running ? "Stop auto-scroll" : "Start auto-scroll"}
          </button>
          <div className="mt-2">
            <Stepper
              label="Scroll speed"
              value={`${settings.autoScrollSpeed} px/s`}
              theme={theme}
              onDec={() =>
                update({
                  autoScrollSpeed: Math.max(
                    SCROLL_SPEED_MIN,
                    settings.autoScrollSpeed - SCROLL_SPEED_STEP,
                  ),
                })
              }
              onInc={() =>
                update({
                  autoScrollSpeed: Math.min(
                    SCROLL_SPEED_MAX,
                    settings.autoScrollSpeed + SCROLL_SPEED_STEP,
                  ),
                })
              }
              onReset={() => update({ autoScrollSpeed: 40 })}
            />
          </div>
        </Group>
      )}

      {/* Saved web pages only: the engine reports this once Readability found
          an article body worth showing. */}
      {caps.cleanView && onCleanView && (
        <Group label="Reading view">
          <Segments
            options={["original", "clean"] as const}
            value={cleanView ? "clean" : "original"}
            onChange={(v) => onCleanView(v === "clean")}
            theme={theme}
            labelFor={(v) => (v === "original" ? "Original" : "Clean")}
          />
        </Group>
      )}

      {/* §6.4: image-only books (comics, scans) can build a text layer with
          OCR. Opt-in, because a 200-page scan is minutes of CPU. */}
      {caps.ocr && onOcrEnabled && (
        <Group label="Text recognition">
          <Segments
            options={["off", "on"] as const}
            value={ocrEnabled ? "on" : "off"}
            onChange={(v) => onOcrEnabled(v === "on")}
            theme={theme}
            labelFor={(v) => (v === "off" ? "Off" : "OCR on")}
          />
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: theme.sub }}>
            Reads the words on each page so this book becomes searchable. Runs in the background and
            can take several minutes.
          </p>
        </Group>
      )}

      {caps.typography !== false && (
        <>
          <Group label="Typeface">
            <Segments
              options={["serif", "sans"] as const}
              value={settings.fontFamily}
              onChange={(f) => update({ fontFamily: f })}
              theme={theme}
              styleFor={(f) => ({
                fontFamily: FONT_STACKS[f],
              })}
            />
          </Group>

          <Stepper
            label="Text size"
            value={`${settings.fontSize}px`}
            onDec={() => update({ fontSize: Math.max(13, settings.fontSize - 1) })}
            onInc={() => update({ fontSize: Math.min(34, settings.fontSize + 1) })}
            theme={theme}
          />
          <Stepper
            label="Line height"
            value={settings.lineHeight.toFixed(2)}
            onDec={() =>
              update({ lineHeight: Math.max(1.2, +(settings.lineHeight - 0.05).toFixed(2)) })
            }
            onInc={() =>
              update({ lineHeight: Math.min(2.4, +(settings.lineHeight + 0.05).toFixed(2)) })
            }
            theme={theme}
          />
          <Stepper
            label="Column width"
            value={`${settings.maxWidth}px`}
            onDec={() => update({ maxWidth: Math.max(420, settings.maxWidth - 40) })}
            onInc={() => update({ maxWidth: Math.min(1100, settings.maxWidth + 40) })}
            theme={theme}
          />

          {/* Phase 15 — reading polish: alignment, hyphenation, rhythm. */}
          <Group label="Alignment">
            <Segments
              options={["start", "justify"] as const}
              value={settings.textAlign}
              onChange={(v) => update({ textAlign: v })}
              theme={theme}
              labelFor={(v) => (v === "start" ? "Ragged" : "Justified")}
            />
            <div className="mt-2">
              <Toggle
                label="Hyphenation"
                state={settings.hyphenate ? "on" : "off"}
                active={settings.hyphenate}
                onClick={() => update({ hyphenate: !settings.hyphenate })}
                theme={theme}
              />
            </div>
          </Group>

          <Stepper
            label="Letter spacing"
            value={settings.letterSpacing === 0 ? "Normal" : `${settings.letterSpacing / 100}em`}
            onDec={() => update({ letterSpacing: Math.max(-2, settings.letterSpacing - 1) })}
            onInc={() => update({ letterSpacing: Math.min(8, settings.letterSpacing + 1) })}
            onReset={() => update({ letterSpacing: 0 })}
            theme={theme}
          />
          <Stepper
            label="Paragraph gap"
            value={
              settings.paragraphSpacing === 0 ? "Indent" : `${settings.paragraphSpacing / 10}em`
            }
            onDec={() => update({ paragraphSpacing: Math.max(0, settings.paragraphSpacing - 2) })}
            onInc={() => update({ paragraphSpacing: Math.min(20, settings.paragraphSpacing + 2) })}
            onReset={() => update({ paragraphSpacing: 0 })}
            theme={theme}
          />
        </>
      )}

      {caps.flowControl && (
        <Group label="Layout">
          <Segments
            options={["paginated", "scrolled"] as const}
            value={settings.flow}
            onChange={(f) => update({ flow: f })}
            theme={theme}
          />
        </Group>
      )}

      {caps.zoom && (
        <Stepper
          label="Zoom"
          value={settings.pdfScale === "fit" ? "Fit" : `${Math.round(settings.pdfScale * 100)}%`}
          onDec={() =>
            update({
              pdfScale: settings.pdfScale === "fit" ? 0.9 : Math.max(0.4, settings.pdfScale - 0.15),
            })
          }
          onInc={() =>
            update({
              pdfScale: settings.pdfScale === "fit" ? 1.25 : Math.min(4, settings.pdfScale + 0.15),
            })
          }
          onReset={() => update({ pdfScale: "fit" })}
          theme={theme}
        />
      )}

      {/* PDF scans. Gated away from the comic engine, which has `rtl`. */}
      {caps.imageAdjust && !caps.rtl && (
        <Group label="Scans">
          <div className="flex gap-2">
            <Toggle
              label="Night scan"
              active={nightScan}
              onClick={() => update({ pdfInvert: !nightScan })}
              theme={theme}
            />
            <Toggle
              label="Trim margins"
              active={settings.pdfCrop}
              onClick={() => update({ pdfCrop: !settings.pdfCrop })}
              theme={theme}
            />
          </div>
          <p className="mt-2 text-[11px] leading-snug opacity-70">
            {settings.pdfInvert === null ? (
              "Night scan follows the reading theme."
            ) : (
              <>
                Night scan is set manually.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => update({ pdfInvert: null })}
                >
                  Follow the theme
                </button>
              </>
            )}
          </p>
        </Group>
      )}

      {caps.spread && (
        <Group label="Spread">
          <Segments
            options={["single", "double"] as const}
            value={settings.spread ? "double" : "single"}
            onChange={(v) => update({ spread: v === "double" })}
            theme={theme}
            labelFor={(v) => (v === "single" ? "One page" : "Two pages")}
          />
        </Group>
      )}

      {/* Comic-only surface: reading direction, spread splitting and fit. */}
      {caps.rtl && (
        <>
          <Group label="Direction">
            <Segments
              options={["ltr", "rtl"] as const}
              value={settings.manga ? "rtl" : "ltr"}
              onChange={(v) => update({ manga: v === "rtl" })}
              theme={theme}
              labelFor={(v) => (v === "ltr" ? "Left to right" : "Manga RTL")}
            />
          </Group>

          <Group label="Wide pages">
            <Toggle
              label="Split wide pages"
              active={settings.splitSpreads}
              onClick={() => update({ splitSpreads: !settings.splitSpreads })}
              theme={theme}
            />
          </Group>

          <Group label="Guided view">
            <Toggle
              label="Guided view"
              state={settings.guidedView ? "on" : "off"}
              active={settings.guidedView}
              onClick={() => update({ guidedView: !settings.guidedView })}
              theme={theme}
            />
            <p
              className="mt-2 font-mono text-[11px] leading-relaxed tracking-[0.08em]"
              style={{ color: theme.sub }}
            >
              Steps panel by panel, zooming each one to fill the screen.
            </p>
          </Group>

          <Group label="Fit">
            <div className="grid grid-cols-3 gap-2">
              {COMIC_FITS.map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => update({ comicFit: fit })}
                  aria-pressed={settings.comicFit === fit}
                  className={cn(
                    "rounded-[3px] border px-2 py-2 text-xs capitalize transition-colors pointer-coarse:min-h-11",
                    settings.comicFit === fit
                      ? "border-signal-ink text-signal-ink"
                      : "hover:bg-foreground/5",
                  )}
                  style={{ borderColor: settings.comicFit === fit ? undefined : theme.line }}
                >
                  {fit}
                </button>
              ))}
            </div>
          </Group>
        </>
      )}

      {caps.imageAdjust && caps.rtl && (
        <>
          <Stepper
            label="Brightness"
            value={`${settings.brightness}%`}
            onDec={() => update({ brightness: Math.max(50, settings.brightness - 5) })}
            onInc={() => update({ brightness: Math.min(200, settings.brightness + 5) })}
            onReset={() => update({ brightness: 100 })}
            theme={theme}
          />
          <Stepper
            label="Contrast"
            value={`${settings.contrast}%`}
            onDec={() => update({ contrast: Math.max(50, settings.contrast - 5) })}
            onInc={() => update({ contrast: Math.min(200, settings.contrast + 5) })}
            onReset={() => update({ contrast: 100 })}
            theme={theme}
          />
          <Group label="Sharp zoom">
            {perBook ? (
              <Segments
                options={["follow", "on", "off"] as const}
                value={sharpZoom === undefined ? "follow" : sharpZoom ? "on" : "off"}
                onChange={(v) => onSharpZoom?.(v === "follow" ? undefined : v === "on")}
                theme={theme}
                labelFor={(v) =>
                  v === "follow" ? `follow (${settings.enhance ? "on" : "off"})` : v
                }
              />
            ) : (
              <Toggle
                label="Enhancer"
                state={settings.enhance ? "on" : "off"}
                active={settings.enhance}
                onClick={() => update({ enhance: !settings.enhance })}
                theme={theme}
              />
            )}
            <p
              className="mt-2 font-mono text-[11px] leading-relaxed tracking-[0.08em]"
              style={{ color: theme.sub }}
            >
              {perBook
                ? "Re-renders zoomed pages at screen resolution so text stays crisp. This choice is remembered for this book."
                : "Re-renders zoomed pages at screen resolution so text stays crisp."}
            </p>
          </Group>
          {sharpOn && (
            <Stepper
              label="Enhance"
              value={
                perBook && sharpAmount === undefined
                  ? `${sharpStrength}% · global`
                  : `${sharpStrength}%`
              }
              onDec={() =>
                perBook
                  ? onSharpAmount?.(Math.max(0, sharpStrength - 5))
                  : update({ enhanceAmount: Math.max(0, settings.enhanceAmount - 5) })
              }
              onInc={() =>
                perBook
                  ? onSharpAmount?.(Math.min(100, sharpStrength + 5))
                  : update({ enhanceAmount: Math.min(100, settings.enhanceAmount + 5) })
              }
              onReset={() => (perBook ? onSharpAmount?.(undefined) : update({ enhanceAmount: 45 }))}
              theme={theme}
            />
          )}
          <Stepper
            label="Sharpen"
            value={settings.sharpen === 0 ? "Off" : `${settings.sharpen}%`}
            onDec={() => update({ sharpen: Math.max(0, settings.sharpen - 10) })}
            onInc={() => update({ sharpen: Math.min(100, settings.sharpen + 10) })}
            onReset={() => update({ sharpen: 0 })}
            theme={theme}
          />
        </>
      )}

      {caps.encoding && onEncoding && (
        <Group label="Encoding">
          <select
            value={caps.encoding.label}
            onChange={(e) => onEncoding(e.target.value)}
            aria-label="Text encoding"
            className="w-full rounded-[3px] border bg-transparent px-2 py-2 text-xs"
            style={{ borderColor: theme.line, color: theme.ink }}
          >
            {ENCODINGS.map((e) => (
              <option
                key={e.label}
                value={e.label}
                style={{ color: theme.ink, background: theme.bg }}
              >
                {e.name}
              </option>
            ))}
          </select>
          <p className="mt-2 font-mono text-[11px] tracking-[0.08em]" style={{ color: theme.sub }}>
            {`DETECTED · ${encodingName(caps.encoding.detected)} · ${Math.round(
              caps.encoding.confidence * 100,
            )}%`}
          </p>
        </Group>
      )}
    </>
  );
}

/**
 * A two-state button. Its name stays the same whichever state it is in and `aria-pressed` carries
 * the state; `state` is the word shown beside the label for people who do not see the colour, and
 * is left out of the name so a screen reader does not say "Hyphenation on, pressed".
 */
function Toggle({
  label,
  state,
  active,
  onClick,
  theme,
}: {
  label: string;
  state?: string;
  active: boolean;
  onClick: () => void;
  theme: ReaderTheme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-[3px] border px-2 py-2 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors pointer-coarse:min-h-11",
        active ? "border-signal-ink text-signal-ink" : "hover:bg-foreground/5",
      )}
      style={{ borderColor: active ? undefined : theme.line }}
    >
      {label}
      {state && <span aria-hidden="true"> {state}</span>}
    </button>
  );
}
