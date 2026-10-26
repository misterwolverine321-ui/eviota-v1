import { describe, expect, it } from "vitest";
import { countFilled, humanizeFieldName, mergeValues, type FormField } from "@/lib/pdf-forms";

const field = (patch: Partial<FormField>): FormField => ({
  name: "f",
  label: "F",
  type: "text",
  readOnly: false,
  value: "",
  ...patch,
});

describe("humanizeFieldName", () => {
  it("cleans underscores and casing", () => {
    expect(humanizeFieldName("first_name")).toBe("First name");
    expect(humanizeFieldName("dateOfBirth")).toBe("Date of birth");
  });

  it("uses the leaf of a qualified name and drops array indices", () => {
    expect(humanizeFieldName("topmostSubform[0].Page1[0].f1_04[0]")).toBe("F1 04");
  });

  it("falls back to the raw name when nothing readable is left", () => {
    expect(humanizeFieldName("[0]")).toBe("[0]");
  });
});

describe("countFilled", () => {
  const fields = [
    field({ name: "a", value: "Ada" }),
    field({ name: "b", value: "" }),
    field({ name: "c", type: "checkbox", checked: true }),
  ];

  it("counts stored answers when there are no edits", () => {
    expect(countFilled(fields)).toBe(2);
  });

  it("prefers pending edits over stored values", () => {
    expect(countFilled(fields, { a: "  ", b: "yes", c: false })).toBe(1);
  });
});

describe("mergeValues", () => {
  const fields = [
    field({ name: "a" }),
    field({ name: "locked", readOnly: true }),
    field({ name: "c", type: "checkbox" }),
  ];

  it("keeps only edits to known, writable fields", () => {
    expect(mergeValues(fields, { a: "Ada", locked: "no", ghost: "x", c: true })).toEqual({
      a: "Ada",
      c: true,
    });
  });

  it("returns nothing when there are no edits", () => {
    expect(mergeValues(fields, {})).toEqual({});
  });
});

describe("read/fill round-trip", () => {
  it("reads fields written by pdf-lib and fills them back", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const form = doc.getForm();
    const name = form.createTextField("first_name");
    name.addToPage(page, { x: 20, y: 150, width: 200, height: 20 });
    const agree = form.createCheckBox("agree");
    agree.addToPage(page, { x: 20, y: 120, width: 12, height: 12 });
    const blob = new Blob([await doc.save()], { type: "application/pdf" });

    const { readFormFields, fillFormFields } = await import("@/lib/pdf-forms");
    const fields = await readFormFields(blob);
    expect(fields.map((f) => f.name).sort()).toEqual(["agree", "first_name"]);

    const filled = await fillFormFields(blob, { first_name: "Ada", agree: true });
    const after = await readFormFields(filled);
    expect(after.find((f) => f.name === "first_name")?.value).toBe("Ada");
    expect(after.find((f) => f.name === "agree")?.checked).toBe(true);
  });
});
