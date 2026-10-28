import { Download, Save } from "lucide-react";
import type { ReaderTheme } from "@/lib/reader-settings";
import { countFilled, type FormField, type FormValues } from "@/lib/pdf-forms";

/**
 * Form filling for PDFs that carry an AcroForm.
 *
 * The tab is a pure surface: it renders the fields the kernel read out of the
 * file, keeps pending edits in the kernel's `values` map, and asks the kernel
 * to write them back.
 */
export interface FormsApi {
  fields: FormField[];
  values: FormValues;
  busy: boolean;
  /** Whether there are unsaved edits. */
  dirty: boolean;
  onChange: (name: string, value: string | boolean) => void;
  onReset: () => void;
  /** Write the answers into the stored file (still editable afterwards). */
  onSave: () => void;
  /** Download a locked-in copy with the answers baked into the page. */
  onSaveCopy: () => void;
}

export function FormsTab({ theme, forms }: { theme: ReaderTheme; forms: FormsApi }) {
  const { fields, values, busy } = forms;
  const filled = countFilled(fields, values);

  const valueOf = (f: FormField) => {
    const raw = values[f.name];
    return raw === undefined ? f.value : String(raw);
  };
  const checkedOf = (f: FormField) => {
    const raw = values[f.name];
    return raw === undefined ? !!f.checked : raw === true;
  };

  const inputStyle = { borderColor: theme.control, color: theme.ink, background: "transparent" };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <ToolButton
          theme={theme}
          disabled={busy || !forms.dirty}
          onClick={forms.onSave}
          icon={<Save className="h-3.5 w-3.5" />}
          label="Save answers"
        />
        <ToolButton
          theme={theme}
          disabled={busy}
          onClick={forms.onSaveCopy}
          icon={<Download className="h-3.5 w-3.5" />}
          label="Save a copy"
        />
      </div>

      <p className="mb-3 font-mono text-[11px] tracking-wide" style={{ color: theme.sub }}>
        {filled} of {fields.length} filled
        {forms.dirty ? " · unsaved changes" : ""}
      </p>

      <div className="flex flex-col gap-3">
        {fields.map((f) => {
          const id = `form-${f.name}`;
          if (f.type === "checkbox") {
            return (
              <label key={f.name} htmlFor={id} className="flex items-center gap-2 text-[13px]">
                <input
                  id={id}
                  type="checkbox"
                  disabled={f.readOnly || busy}
                  checked={checkedOf(f)}
                  onChange={(e) => forms.onChange(f.name, e.target.checked)}
                  className="h-3.5 w-3.5 accent-signal"
                />
                <span style={{ color: theme.ink }}>{f.label}</span>
              </label>
            );
          }
          return (
            <div key={f.name} className="flex flex-col gap-1">
              <label
                htmlFor={id}
                className="font-mono text-[11px] tracking-[0.1em] uppercase"
                style={{ color: theme.sub }}
              >
                {f.label}
              </label>
              {f.options ? (
                <select
                  id={id}
                  disabled={f.readOnly || busy}
                  value={valueOf(f)}
                  onChange={(e) => forms.onChange(f.name, e.target.value)}
                  className="rounded-[3px] border px-2 py-1.5 text-[13px] disabled:opacity-40"
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.multiline ? (
                <textarea
                  id={id}
                  rows={3}
                  disabled={f.readOnly || busy}
                  maxLength={f.maxLength}
                  value={valueOf(f)}
                  onChange={(e) => forms.onChange(f.name, e.target.value)}
                  className="rounded-[3px] border px-2 py-1.5 text-[13px] disabled:opacity-40"
                  style={inputStyle}
                />
              ) : (
                <input
                  id={id}
                  type="text"
                  disabled={f.readOnly || busy}
                  maxLength={f.maxLength}
                  value={valueOf(f)}
                  onChange={(e) => forms.onChange(f.name, e.target.value)}
                  className="rounded-[3px] border px-2 py-1.5 text-[13px] disabled:opacity-40"
                  style={inputStyle}
                />
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={forms.onReset}
        disabled={busy || !forms.dirty}
        className="mt-4 font-mono text-[11px] tracking-[0.1em] uppercase underline-offset-2 hover:underline disabled:opacity-40"
        style={{ color: theme.sub }}
      >
        Discard changes
      </button>

      <p
        className="mt-3 font-mono text-[11px] leading-relaxed tracking-wide"
        style={{ color: theme.sub }}
      >
        Saving answers rewrites the stored file. A saved copy is locked in and can no longer be
        edited.
      </p>
    </div>
  );
}

function ToolButton({
  theme,
  icon,
  label,
  onClick,
  disabled,
}: {
  theme: ReaderTheme;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-[3px] border px-2 py-1.5 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors hover:bg-foreground/5 disabled:opacity-40"
      style={{ borderColor: theme.line }}
    >
      {icon}
      {label}
    </button>
  );
}
