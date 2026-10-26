import type { Page } from "@playwright/test";

/**
 * Accessible-name and structure audit for the specs in this folder.
 *
 * The names come from the browser itself: Chromium's accessibility tree through the DevTools
 * protocol (`Accessibility.getFullAXTree`), so an element's name is what a screen reader is given
 * after the browser has applied aria-labelledby, aria-label, native labels, alt text, content and
 * title in the order the specifications set. This works only in Chromium. In another engine
 * `auditAccessibleNames` throws, and callers skip.
 *
 * What it checks, per page state:
 *  - every control and landmark that must have a name has one (`name-missing`);
 *  - a control's name contains its visible text (`label-not-in-name`, WCAG 2.5.3: a voice-control
 *    user says what they see). Text inside an aria-hidden descendant is not counted: a state word
 *    such as "Off" that the author has hidden because aria-pressed already says it is not the label;
 *  - two buttons or two links never share a name inside the same named group or dialog unless the
 *    caller says that is intended (`repeated-name`: six "Add tag" buttons in one list tell a
 *    screen-reader user nothing about which book; "Off" in two differently named groups is fine);
 *  - landmarks of one kind carry different names, and there is one main (`landmark`);
 *  - ids are unique and aria-labelledby / aria-describedby / aria-controls point at something that
 *    exists (`dangling-reference`, `duplicate-id`);
 *  - `aria-selected` sits only where the role allows it and `aria-label` is not put on a bare
 *    div or span, where it is ignored (`invalid-aria`);
 *  - nothing focusable sits inside aria-hidden content other than what an open modal hides
 *    (`focusable-hidden`); no positive tabindex (`positive-tabindex`);
 *  - the page has a language and a title, one h1, no empty heading and no heading level skipped
 *    on the way down (`document`);
 *  - every iframe that is shown has a title (`iframe-title`).
 *
 * It does not find everything: it cannot judge whether a name is a good one, and contrast, focus
 * order and how a screen reader actually speaks the page are outside it.
 */

export interface A11yProblem {
  rule: string;
  role: string;
  name: string;
  html: string;
}

export interface AuditOptions {
  /** Names that two or more buttons or links may share on purpose, e.g. a header and a hero "Add books". */
  repeatedNames?: string[];
}

/** Roles whose accessible name is required (WAI-ARIA 1.2: name from author, or from content, required). */
const NEEDS_NAME = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "tab",
  "tabpanel",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "image",
  "img",
  "dialog",
  "alertdialog",
  "progressbar",
  "meter",
  "DisclosureTriangle",
  "form",
  "region",
]);

/** Roles that take their name from their own visible text, so the visible text must be in it. */
const NAME_FROM_CONTENT = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
]);

/** Roles whose own name tells a user which "Off" or "Delete" they are on. */
const CONTEXT_ROLES = new Set([
  "group",
  "radiogroup",
  "toolbar",
  "tablist",
  "list",
  "listitem",
  "dialog",
  "alertdialog",
  "region",
  "navigation",
  "complementary",
  "banner",
  "form",
  "article",
  "tabpanel",
]);

const LANDMARKS = new Set([
  "banner",
  "main",
  "navigation",
  "complementary",
  "contentinfo",
  "region",
]);

interface AxProperty {
  name: string;
  value?: { value?: unknown };
}
interface AxNode {
  nodeId?: string;
  parentId?: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  backendDOMNodeId?: number;
  properties?: AxProperty[];
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export interface AxSummary {
  role: string;
  name: string;
  value: string;
}

/** The unignored nodes of the accessibility tree, as `{ role, name, value }`, for specs that assert a name. */
export async function axNodes(page: Page): Promise<AxSummary[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Accessibility.enable");
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
    return nodes
      .filter((n) => !n.ignored)
      .map((n) => ({
        role: n.role?.value ?? "",
        name: squash(String(n.name?.value ?? "")),
        value: String(n.value?.value ?? ""),
      }));
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export async function auditAccessibleNames(
  page: Page,
  options: AuditOptions = {},
): Promise<A11yProblem[]> {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName !== "chromium") {
    throw new Error(`auditAccessibleNames needs Chromium's accessibility tree, not ${browserName}`);
  }
  const allowRepeated = new Set((options.repeatedNames ?? []).map((n) => n.toLowerCase()));
  const cdp = await page.context().newCDPSession(page);
  const problems: A11yProblem[] = [];
  try {
    await cdp.send("DOM.enable");
    await cdp.send("Accessibility.enable");
    const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };

    const htmlOf = async (id: number): Promise<string> => {
      try {
        const { outerHTML } = await cdp.send("DOM.getOuterHTML", { backendNodeId: id });
        return squash(outerHTML).slice(0, 220);
      } catch {
        return "(element gone)";
      }
    };
    const visibleTextOf = async (id: number): Promise<string> => {
      try {
        const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: id });
        if (!object.objectId) return "";
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: `function () {
            if (this.nodeType !== 1) return '';
            const copy = this.cloneNode(true);
            copy.querySelectorAll('[aria-hidden="true"], svg, .sr-only').forEach((n) => n.remove());
            // innerText needs layout; textContent on the pruned copy does not.
            return copy.textContent || '';
          }`,
          returnByValue: true,
        });
        return String(result.value ?? "");
      } catch {
        return "";
      }
    };

    const byId = new Map<string, AxNode>();
    for (const node of nodes) if (node.nodeId) byId.set(node.nodeId, node);
    /** The names of the named groups, lists, dialogs and regions a node sits in, outermost first. */
    const contextOf = (node: AxNode): string => {
      const chain: string[] = [];
      for (let at = node.parentId ? byId.get(node.parentId) : undefined; at;) {
        const role = at.role?.value ?? "";
        const name = squash(String(at.name?.value ?? ""));
        if (!at.ignored && name && CONTEXT_ROLES.has(role)) chain.unshift(`${role}:${name}`);
        at = at.parentId ? byId.get(at.parentId) : undefined;
      }
      return chain.join(" > ");
    };

    const byRoleAndName = new Map<string, { role: string; name: string; id: number }[]>();
    const landmarks = new Map<string, { name: string; id: number }[]>();

    for (const node of nodes) {
      if (node.ignored) continue;
      const role = node.role?.value ?? "";
      const id = node.backendDOMNodeId;
      if (id === undefined) continue;
      const name = squash(String(node.name?.value ?? ""));
      const hidden = node.properties?.some((p) => p.name === "hidden" && p.value?.value === true);
      if (hidden) continue;

      if (LANDMARKS.has(role)) {
        const list = landmarks.get(role) ?? [];
        list.push({ name, id });
        landmarks.set(role, list);
      }
      if (role === "button" || role === "link") {
        const key = `${role}\u0000${name.toLowerCase()}\u0000${contextOf(node)}`;
        const list = byRoleAndName.get(key) ?? [];
        list.push({ role, name, id });
        byRoleAndName.set(key, list);
      }

      if (!NEEDS_NAME.has(role)) continue;
      if (!name) {
        problems.push({ rule: "name-missing", role, name, html: await htmlOf(id) });
        continue;
      }
      if (NAME_FROM_CONTENT.has(role)) {
        const visible = squash(await visibleTextOf(id));
        const flat = (text: string) => text.replace(/\s+/g, "").toLowerCase();
        if (visible && !flat(name).includes(flat(visible))) {
          problems.push({
            rule: "label-not-in-name",
            role,
            name: `${name}  (visible text: ${visible.slice(0, 60)})`,
            html: await htmlOf(id),
          });
        }
      }
    }

    for (const group of byRoleAndName.values()) {
      if (group.length < 2 || !group[0]!.name) continue;
      if (allowRepeated.has(group[0]!.name.toLowerCase())) continue;
      problems.push({
        rule: "repeated-name",
        role: group[0]!.role,
        name: `${group[0]!.name}  (x${group.length})`,
        html: await htmlOf(group[0]!.id),
      });
    }

    for (const [role, list] of landmarks) {
      if (role === "main" && list.length !== 1) {
        problems.push({
          rule: "landmark",
          role,
          name: `${list.length} main landmarks (want 1)`,
          html: "",
        });
      }
      if (list.length > 1) {
        const names = list.map((l) => l.name.toLowerCase());
        if (new Set(names).size !== names.length) {
          problems.push({
            rule: "landmark",
            role,
            name: `${list.length} ${role} landmarks without distinct names: ${names.join(" | ") || "(unnamed)"}`,
            html: await htmlOf(list[0]!.id),
          });
        }
      }
    }
  } finally {
    await cdp.detach().catch(() => undefined);
  }
  return problems;
}

/** Checks that need the DOM rather than the accessibility tree. Works in any engine. */
export async function auditStructure(page: Page): Promise<A11yProblem[]> {
  return page.evaluate(() => {
    const out: { rule: string; role: string; name: string; html: string }[] = [];
    const brief = (el: Element) => el.outerHTML.replace(/\s+/g, " ").slice(0, 200);
    const add = (rule: string, el: Element | null, name = "") =>
      out.push({
        rule,
        role: el?.getAttribute("role") ?? el?.tagName.toLowerCase() ?? "",
        name,
        html: el ? brief(el) : "",
      });
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && !el.closest("[hidden]");
    };

    // Document-level facts.
    if (!document.documentElement.getAttribute("lang")) {
      add("document", document.documentElement, "html has no lang attribute");
    }
    if (!document.title.trim()) add("document", document.documentElement, "document has no title");
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(
      shown,
    );
    const level = (h: Element) =>
      Number(h.getAttribute("aria-level") ?? (/^h[1-6]$/i.test(h.tagName) ? h.tagName[1] : 2));
    // An open dialog hides the page behind it from assistive technology (Radix does it with
    // aria-hidden), so the page's own headings and controls are expected to leave the tree.
    const modalOpen = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].some(
      shown,
    );
    const inTree = (h: Element) => !h.closest('[aria-hidden="true"]');
    const treeHeadings = headings.filter(inTree);
    const h1s = treeHeadings.filter((h) => level(h) === 1);
    if (!modalOpen && h1s.length !== 1) {
      add("document", null, `${h1s.length} level-1 headings (want 1)`);
    }
    let last = 0;
    for (const h of treeHeadings) {
      const l = level(h);
      if (!(h.textContent ?? "").trim() && !h.getAttribute("aria-label"))
        add("document", h, "empty heading");
      if (last && l > last + 1) add("document", h, `heading level jumps from ${last} to ${l}`);
      last = l;
    }

    // ids and references.
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    for (const [id, count] of seen) {
      if (count > 1)
        add("duplicate-id", document.getElementById(id), `id="${id}" used ${count} times`);
    }
    for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        if (!shown(el)) continue;
        for (const id of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
          if (document.getElementById(id)) continue;
          // aria-controls may point at content that is not mounted while collapsed.
          if (attr === "aria-controls" && el.getAttribute("aria-expanded") === "false") continue;
          add("dangling-reference", el, `${attr}="${id}" matches nothing`);
        }
      }
    }

    // Attributes on elements that do not support them.
    const SELECTABLE = new Set([
      "tab",
      "option",
      "row",
      "gridcell",
      "columnheader",
      "rowheader",
      "treeitem",
    ]);
    for (const el of document.querySelectorAll("[aria-selected]")) {
      if (!SELECTABLE.has(el.getAttribute("role") ?? "")) {
        add("invalid-aria", el, "aria-selected on an element whose role does not support it");
      }
    }
    for (const el of document.querySelectorAll(
      "div[aria-label]:not([role]), span[aria-label]:not([role]), p[aria-label]:not([role])",
    )) {
      add("invalid-aria", el, "aria-label on a div, span or p with no role: browsers ignore it");
    }

    // Focusable content inside aria-hidden, other than the page a modal dialog hides behind it.
    const focusable =
      "a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=true]";
    for (const hiddenBox of document.querySelectorAll(
      '[aria-hidden="true"], [data-aria-hidden="true"]',
    )) {
      if (hiddenBox.hasAttribute("data-radix-focus-guard")) continue;
      if (modalOpen && !hiddenBox.closest('[role="dialog"], [role="alertdialog"]')) continue;
      for (const el of hiddenBox.matches(focusable)
        ? [hiddenBox]
        : hiddenBox.querySelectorAll(focusable)) {
        if (el.getAttribute("tabindex") === "-1" || (el as HTMLButtonElement).disabled) continue;
        if (!shown(el)) continue;
        add("focusable-hidden", el, "focusable but inside aria-hidden");
      }
    }
    for (const el of document.querySelectorAll("[tabindex]")) {
      if (Number(el.getAttribute("tabindex")) > 0) add("positive-tabindex", el, "tabindex above 0");
    }

    // Frames.
    for (const frame of document.querySelectorAll("iframe")) {
      if (!shown(frame)) continue;
      if (!(frame.getAttribute("title") ?? "").trim() && !frame.getAttribute("aria-label")) {
        add("iframe-title", frame, "iframe has no title");
      }
    }
    return out;
  });
}
