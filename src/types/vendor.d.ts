declare module "foliate-js/view.js" {
  export const makeBook: (file: Blob | string) => Promise<any>;
  export class View extends HTMLElement {
    book: any;
    renderer: any;
    isFixedLayout: boolean;
    lastLocation: any;
    open(book: any): Promise<void>;
    close(): void;
    goTo(target: any): Promise<any>;
    goToFraction(fraction: number): Promise<void>;
    goToTextStart(): Promise<any>;
    goLeft(): Promise<any> | void;
    goRight(): Promise<any> | void;
    getTOCItemOf(target: any): Promise<any>;
    init?(options: any): void;
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
  export class Overlayer {
    static highlight: (rects: DOMRect[], options?: any) => any;
    static underline: (rects: DOMRect[], options?: any) => any;
    static strikethrough: (rects: DOMRect[], options?: any) => any;
    static squiggly: (rects: DOMRect[], options?: any) => any;
    static outline: (rects: DOMRect[], options?: any) => any;
    element: HTMLElement;
    add(key: any, range: Range | (() => Range), draw: any, options?: any): void;
    remove(key: any): void;
    redraw(): void;
    hitTest(event: { clientX: number; clientY: number }): any[];
  }
}
