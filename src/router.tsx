import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

/**
 * Hash-based history (`#/read/abc`) keeps Eviota a pure static app: the host
 * only ever serves `index.html`, so there are no server rewrite rules, no 404
 * redirect tricks, and the same build works on a sub-path, a custom domain, or
 * any plain static host such as a Cloudflare Worker. It also lets the offline shell be
 * a single precached document.
 */
export function createAppRouter() {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
