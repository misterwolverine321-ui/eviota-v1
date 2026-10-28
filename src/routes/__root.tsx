import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { Toaster } from "@/components/ui/sonner";
import { benchRequested, markAppReady } from "@/lib/app-ready";
import { registerServiceWorker } from "@/lib/pwa";
import { useTheme } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Static tags (charset, viewport, theme-color, icons, manifest, fonts) live in
  // index.html. Only what a route may override belongs here.
  head: () => ({
    meta: [
      { title: "Eviota — Read every e-book format in your browser" },
      {
        name: "description",
        content:
          "A private, offline-first reading room for EPUB, PDF, MOBI, AZW3, FB2, comics, text and HTML.",
      },
      { property: "og:title", content: "Eviota — Your browser reading room" },
      {
        property: "og:description",
        content:
          "Import EPUB, PDF, MOBI, comics and more. Beautiful typography, saved progress, fully offline.",
      },
      { property: "og:type", content: "website" },
    ],
  }),

  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/**
 * The reader's bottom bar is 48 px high. A toast at the default offset (24 px, 16 on a phone)
 * covers its right-hand end, which is the Next page button, and on a touch screen a tap on the
 * toast pauses it, so it stays there. In the reader, toasts sit above the bar.
 */
const READER_TOAST_OFFSET = { bottom: 64 };

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useTheme();
  const inReader = useRouterState({ select: (s) => s.location.pathname.startsWith("/read/") });

  useEffect(() => {
    // Developer tooling, loaded only for `/?bench`: window.__eviotaBench (see lib/bench).
    if (benchRequested(window.location.search)) {
      void import("@/lib/bench").then((m) => m.installBench());
    }
    // Offline shell. Production builds only — see lib/pwa.
    registerServiceWorker();
    // Last, so that everything this effect starts has been started when the tests see it.
    markAppReady();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster
        offset={inReader ? READER_TOAST_OFFSET : undefined}
        mobileOffset={inReader ? READER_TOAST_OFFSET : undefined}
      />
    </QueryClientProvider>
  );
}
