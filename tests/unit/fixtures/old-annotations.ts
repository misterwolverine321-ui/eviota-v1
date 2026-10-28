/**
 * Records made by an earlier build (the one with the triple-click overshoot) and
 * by the current build from the same gestures on the same hostile EPUB, copied from the
 * `annotations.json` of a backup each one exported. Each pair is
 * [what the old build stored, what the fixed build stores]. Only the fields that matter here.
 */
export const REAL_PAIRS = [
  [
    {
      type: "underline",
      color: "yellow",
      text: "Paragraph 3: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
      anchor: {
        kind: "text",
        page: 1,
        start: 376,
        end: 584,
        quote:
          "Paragraph 3: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.Paragraph 4: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "javascript link and next chapter",
        suffix: "Paragraph 5: the quick brown fox",
        cfi: "epubcfi(/6/2!/4,/20/1:0,/22/1:104)",
      },
    },
    {
      type: "underline",
      color: "yellow",
      text: "Paragraph 3: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
      anchor: {
        kind: "text",
        page: 1,
        start: 376,
        end: 480,
        quote:
          "Paragraph 3: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "javascript link and next chapter",
        suffix: "Paragraph 4: the quick brown fox",
        cfi: "epubcfi(/6/2!/4/20,/1:0,/1:104)",
      },
    },
  ],
  [
    {
      type: "highlight",
      color: "yellow",
      text: "Paragraph 5: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
      anchor: {
        kind: "text",
        page: 1,
        start: 584,
        end: 688,
        quote:
          "Paragraph 5: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "r scrolls through ordinary text.",
        suffix: "",
        cfi: "epubcfi(/6/2!/4/24,/1:0,/1:104)",
      },
    },
    {
      type: "highlight",
      color: "yellow",
      text: "Paragraph 5: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
      anchor: {
        kind: "text",
        page: 1,
        start: 584,
        end: 688,
        quote:
          "Paragraph 5: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "r scrolls through ordinary text.",
        suffix: "",
        cfi: "epubcfi(/6/2!/4/24,/1:0,/1:104)",
      },
    },
  ],
  [
    {
      type: "highlight",
      color: "yellow",
      text: "ALPHA",
      anchor: {
        kind: "rect",
        page: 1,
        rects: [
          {
            x: 0.0951958198051948,
            y: 0.15433051090700345,
            w: 0.3747460501534598,
            h: 0.09012629161882893,
          },
        ],
      },
    },
    {
      type: "highlight",
      color: "yellow",
      text: "ALPHA",
      anchor: {
        kind: "rect",
        page: 1,
        rects: [
          {
            x: 0.0951958198051948,
            y: 0.15433051090700345,
            w: 0.3747460501534598,
            h: 0.09012629161882893,
          },
        ],
      },
    },
  ],
  [
    {
      type: "highlight",
      color: "yellow",
      text: "Paragraph 1: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
      note: "my note on paragraph one",
      anchor: {
        kind: "text",
        page: 1,
        start: 94,
        end: 302,
        quote:
          "Paragraph 1: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.Paragraph 2: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "s sentence for the export check.",
        suffix: "Click-handler paragraph.external",
        cfi: "epubcfi(/6/2!/4,/6/1:0,/8/1:104)",
      },
    },
    {
      type: "highlight",
      color: "yellow",
      text: "Paragraph 1: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
      note: "my note on paragraph one",
      anchor: {
        kind: "text",
        page: 1,
        start: 94,
        end: 198,
        quote:
          "Paragraph 1: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "s sentence for the export check.",
        suffix: "Paragraph 2: the quick brown fox",
        cfi: "epubcfi(/6/2!/4/6,/1:0,/1:104)",
      },
    },
  ],
  [
    {
      type: "highlight",
      color: "yellow",
      text: "Real text that the reader should see. Highlight this sentence for the export check.",
      anchor: {
        kind: "text",
        page: 1,
        start: 11,
        end: 198,
        quote:
          "Real text that the reader should see. Highlight this sentence for the export check.Paragraph 1: the quick brown fox jumps over the lazy dog while the reader scrolls through ordinary text.",
        prefix: "Chapter One",
        suffix: "Paragraph 2: the quick brown fox",
        cfi: "epubcfi(/6/2!/4,/4[target]/1:0,/6/1:104)",
      },
    },
    {
      type: "highlight",
      color: "yellow",
      text: "Real text that the reader should see. Highlight this sentence for the export check.",
      anchor: {
        kind: "text",
        page: 1,
        start: 11,
        end: 94,
        quote:
          "Real text that the reader should see. Highlight this sentence for the export check.",
        prefix: "Chapter One",
        suffix: "Paragraph 1: the quick brown fox",
        cfi: "epubcfi(/6/2!/4/4[target],/1:0,/1:83)",
      },
    },
  ],
] as const;
