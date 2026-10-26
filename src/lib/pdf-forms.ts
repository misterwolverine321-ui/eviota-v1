/**
 * PDF form filling (AcroForm).
 *
 * Reading and writing are pure blob-in / blob-out, like `pdf-ops`: nothing
 * here touches IndexedDB. pdf-lib is loaded lazily so readers who never open
 * a form never pay for it.
 */

const loadLib = () => import("pdf-lib");

export type FormFieldType = "text" | "checkbox" | "radio" | "dropdown" | "list";

/** A single fillable control, flattened into something a UI can render. */
export interface FormField {
  /** Fully-qualified AcroForm name — the key used when writing values back. */
  name: string;
  /** Human-friendly label derived from the name. */
  label: string;
  type: FormFieldType;
  readOnly: boolean;
  /** Free-text value (text) or the selected option (radio / dropdown / list). */
  value: string;
  /** Checkbox state. */
  checked?: boolean;
  /** Choices for radio / dropdown / list. */
  options?: string[];
  multiline?: boolean;
  maxLength?: number | undefined;
}

/** Value shape accepted per field when writing. */
export type FormValues = Record<string, string | boolean>;

/**
 * Turn an AcroForm field name into something readable.
 * `topmostSubform[0].Page1[0].f1_04[0]` → `f1 04`, `first_name` → `First name`.
 */
export function humanizeFieldName(name: string): string {
  const leaf = name.split(".").pop() ?? name;
  const cleaned = leaf
    .replace(/\[\d+\]/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return name;
  const lower = cleaned.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** How many fields carry an answer — drives the "3 of 12 filled" hint. */
export function countFilled(fields: FormField[], values: FormValues = {}): number {
  return fields.filter((f) => {
    const raw = values[f.name];
    if (f.type === "checkbox") return raw === undefined ? !!f.checked : raw === true;
    const v = raw === undefined ? f.value : String(raw);
    return v.trim().length > 0;
  }).length;
}

/** Merge edits over the read snapshot, dropping unknown and read-only keys. */
export function mergeValues(fields: FormField[], edits: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (f.readOnly) continue;
    const edited = edits[f.name];
    if (edited === undefined) continue;
    if (f.type === "checkbox") out[f.name] = edited === true;
    else if (typeof edited === "string") out[f.name] = edited;
  }
  return out;
}

async function openDoc(blob: Blob) {
  const { PDFDocument } = await loadLib();
  return PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
}

/** Read every fillable field out of a PDF. Empty array when there's no form. */
export async function readFormFields(blob: Blob): Promise<FormField[]> {
  const lib = await loadLib();
  const doc = await openDoc(blob);
  let raw: unknown[];
  try {
    raw = doc.getForm().getFields();
  } catch {
    return [];
  }
  const out: FormField[] = [];
  for (const field of raw as { getName(): string; isReadOnly(): boolean }[]) {
    const name = field.getName();
    const base = { name, label: humanizeFieldName(name), readOnly: field.isReadOnly() };
    if (field instanceof lib.PDFTextField) {
      out.push({
        ...base,
        type: "text",
        value: field.getText() ?? "",
        multiline: field.isMultiline(),
        maxLength: field.getMaxLength() ?? undefined,
      });
    } else if (field instanceof lib.PDFCheckBox) {
      out.push({ ...base, type: "checkbox", value: "", checked: field.isChecked() });
    } else if (field instanceof lib.PDFRadioGroup) {
      out.push({
        ...base,
        type: "radio",
        value: field.getSelected() ?? "",
        options: field.getOptions(),
      });
    } else if (field instanceof lib.PDFDropdown) {
      out.push({
        ...base,
        type: "dropdown",
        value: field.getSelected()[0] ?? "",
        options: field.getOptions(),
      });
    } else if (field instanceof lib.PDFOptionList) {
      out.push({
        ...base,
        type: "list",
        value: field.getSelected()[0] ?? "",
        options: field.getOptions(),
      });
    }
  }
  return out;
}

/**
 * Write values back into the form.
 *
 * `flatten` bakes the answers into the page content so the result reads the
 * same everywhere and can no longer be edited.
 */
export async function fillFormFields(
  blob: Blob,
  values: FormValues,
  opts: { flatten?: boolean } = {},
): Promise<Blob> {
  const lib = await loadLib();
  const doc = await openDoc(blob);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    let field: unknown;
    try {
      field = form.getField(name);
    } catch {
      continue; // Field vanished (file rewritten under us) — skip, don't fail.
    }
    try {
      if (field instanceof lib.PDFTextField) field.setText(String(value));
      else if (field instanceof lib.PDFCheckBox) {
        if (value === true || value === "true") field.check();
        else field.uncheck();
      } else if (
        field instanceof lib.PDFRadioGroup ||
        field instanceof lib.PDFDropdown ||
        field instanceof lib.PDFOptionList
      ) {
        const v = String(value);
        if (v) field.select(v);
        else field.clear();
      }
    } catch {
      // A single stubborn field must not sink the whole save.
    }
  }

  try {
    form.updateFieldAppearances();
  } catch {
    /* appearances are best-effort */
  }
  if (opts.flatten) {
    try {
      form.flatten();
    } catch {
      /* keep the filled-but-editable version rather than failing the save */
    }
  }
  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}
