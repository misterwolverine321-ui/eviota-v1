declare module "foliate-js/view.js" {
  /** A table-of-contents entry, as foliate's parsers give it. */
  export interface TocEntry {
    label: string;
    href: string;
    subitems?: TocEntry[];
  }

  /** The label foliate gives a position in the table of contents or the page list. */
  export interface ProgressItem {
    label?: string;
  }

  /** One section of a book. `createDocument` is absent for a section foliate cannot load. */
  export interface BookSection {
    id?: string;
    linear?: string;
    cfi?: string;
    createDocument?: () => Promise<Document>;
  }

  /** A book as `makeBook` returns it. Only the fields the app reads are declared. */
  export interface Book {
    metadata?: { title?: unknown; creator?: unknown; author?: unknown; language?: unknown };
    sections: BookSection[];
    toc?: TocEntry[];
    pageList?: TocEntry[];
    getCover?: () => Promise<Blob | null | undefined>;
    splitTOCHref?(href: string): unknown;
    getTOCFragment?(doc: unknown, id: unknown): unknown;
  }

  /** The position foliate reports on `relocate`, and keeps as `lastLocation`. */
  export interface LastLocation {
    cfi?: string;
    index?: number;
    fraction?: number;
    range?: Range;
    tocItem?: ProgressItem | null;
    pageItem?: ProgressItem | null;
  }

  /** Where the renderer should go: a section, optionally with an anchor inside it. */
  export interface RenderTarget {
    index: number;
    anchor?:
      number | Range | Element | ((doc: Document) => number | Range | Element | null | undefined);
    select?: boolean;
  }

  /** A section the renderer has loaded. */
  export interface RenderedSection {
    index: number;
    doc: Document;
    overlayer?: { element: HTMLElement };
  }

  /** The paginator (or fixed-layout) element that lays out the sections. */
  export interface Renderer {
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): string | null;
    goTo(target: RenderTarget): Promise<void>;
    getContents(): RenderedSection[];
    setStyles(styles: string): void;
    scrollBy(dx: number, dy: number): void;
    next(distance?: number): Promise<void>;
    prev(distance?: number): Promise<void>;
  }

  export interface SearchOptions {
    query: string;
    index?: number;
    scope?: string;
    matchCase?: boolean;
    matchWholeWords?: boolean;
  }

  export interface SearchSubitem {
    cfi: string;
    excerpt?: { pre?: string; match?: string; post?: string };
  }

  /** One value a search yields: a progress reading, or the hits of one section. */
  export interface SearchResult {
    progress?: number;
    label?: string;
    subitems?: SearchSubitem[];
  }

  /** Detail of `draw-annotation`: paints the mark with the given overlay drawer. */
  export interface DrawAnnotationDetail {
    draw?: (
      func: import("foliate-js/overlayer.js").OverlayDraw,
      options?: import("foliate-js/overlayer.js").OverlayOptions,
    ) => void;
    annotation?: { value?: string };
  }

  /** Detail of `show-annotation`: a tap on a mark that foliate already draws. */
  export interface ShowAnnotationDetail {
    value?: string;
    index?: number;
    range?: Range | null;
  }

  /** Detail of `create-overlay`: a section has mounted its overlay. */
  export interface CreateOverlayDetail {
    index?: number;
  }

  /** Detail of `load`: a section document has loaded. */
  export interface LoadDetail {
    doc?: Document;
    index?: number;
  }

  export const makeBook: (file: Blob | string) => Promise<Book>;

  export class View extends HTMLElement {
    book: Book;
    renderer: Renderer;
    history: { pushState(state: unknown): void };
    isFixedLayout: boolean;
    lastLocation?: LastLocation | null;
    open(book: Book): Promise<void>;
    close(): void;
    init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number | { fraction: number }): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    goToTextStart(): Promise<unknown>;
    next(distance?: number): Promise<void>;
    prev(distance?: number): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    getTOCItemOf(target: string | number): Promise<unknown>;
    getProgressOf(
      index: number,
      range?: Range,
    ): { tocItem?: ProgressItem | null; pageItem?: ProgressItem | null } | undefined;
    getCFI(index: number, range?: Range): string;
    addAnnotation(annotation: { value: string }, remove?: boolean): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    search(opts: SearchOptions): AsyncGenerator<SearchResult | "done", void, undefined>;
    clearSearch(): void;
  }
}

declare module "foliate-js/progress.js" {
  export class TOCProgress {
    init(options: {
      toc: unknown[];
      ids: unknown[];
      splitHref: (href: string) => unknown;
      getFragment: (doc: unknown, id: unknown) => unknown;
    }): Promise<void>;
    getProgress(index: number, range?: Range): { label?: string } | null | undefined;
  }
}

declare module "*.mjs?url" {
  const src: string;
  export default src;
}

declare module "foliate-js/overlayer.js" {
  /** Options a mark is drawn with. The app passes only a colour. */
  export interface OverlayOptions {
    color?: string;
    width?: number;
    padding?: number;
    writingMode?: string;
  }

  /** Draws one mark over a list of client rects and returns the SVG it made. */
  export type OverlayDraw = (rects: DOMRect[], options?: OverlayOptions) => SVGElement;

  export class Overlayer {
    static highlight: OverlayDraw;
    static underline: OverlayDraw;
    static strikethrough: OverlayDraw;
    static squiggly: OverlayDraw;
    static outline: OverlayDraw;
    element: HTMLElement;
    add(
      key: string,
      range: Range | (() => Range),
      draw: OverlayDraw,
      options?: OverlayOptions,
    ): void;
    remove(key: string): void;
    redraw(): void;
    hitTest(point: { x: number; y: number }): [string, Range] | [];
  }
}
