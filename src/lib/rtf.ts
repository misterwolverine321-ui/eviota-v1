/**
 * Minimal RTF → plain text converter.
 * Handles control words, groups, hex escapes and common encodings well
 * enough for comfortable reading. Not a layout engine.
 */
export function rtfToText(input: string): string {
  let text = input;

  // Drop the header tables that carry no prose
  text = text.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|\*\\[^{}]+)[^}]*\}/gs, " ");

  const out: string[] = [];
  let i = 0;
  let skipDepth = -1; // depth at which we are skipping a group
  let depth = 0;

  const push = (s: string) => {
    if (skipDepth === -1) out.push(s);
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      if (skipDepth === depth) skipDepth = -1;
      depth--;
      i++;
      continue;
    }
    if (ch === "\\") {
      // Hex escape \'hh
      if (text[i + 1] === "'" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
        const code = parseInt(text.slice(i + 2, i + 4), 16);
        push(code >= 32 ? String.fromCharCode(code) : " ");
        i += 4;
        continue;
      }
      // Control symbol
      if (/[^a-zA-Z0-9]/.test(text[i + 1] ?? "")) {
        const sym = text[i + 1];
        if (sym === "~") push(" ");
        else if (sym === "-" || sym === "_") push("-");
        else if (sym === "*")
          skipDepth = depth + 1; // ignorable destination
        else if (sym === "{" || sym === "}" || sym === "\\") push(sym);
        i += 2;
        continue;
      }
      // Control word
      let j = i + 1;
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
      const word = text.slice(i + 1, j);
      let num = "";
      while (j < text.length && /[0-9-]/.test(text[j])) {
        num += text[j];
        j++;
      }
      if (text[j] === " ") j++; // consume delimiter space

      switch (word) {
        // A paragraph end is a paragraph break. It used to be one newline, the same as a soft line
        // break, so a whole document came out as a single paragraph: no paragraph spacing, no
        // chapter detection, and a search jump that centred the paragraph (the middle of the file).
        case "par":
          push("\n\n");
          break;
        case "line":
          push("\n");
          break;
        case "tab":
          push("    ");
          break;
        case "emdash":
          push("—");
          break;
        case "endash":
          push("–");
          break;
        case "lquote":
          push("‘");
          break;
        case "rquote":
          push("’");
          break;
        case "ldblquote":
          push("“");
          break;
        case "rdblquote":
          push("”");
          break;
        case "bullet":
          push("•");
          break;
        case "u":
          push(String.fromCodePoint(parseInt(num, 10) & 0xffff));
          break;
        default:
          break;
      }
      i = j;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    push(ch);
    i++;
  }

  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
