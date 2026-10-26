import { Link, useRouter } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";

interface BackLinkProps {
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}

/**
 * A link to the library that behaves like Back.
 *
 * A plain `<Link to="/">` pushes a new history entry, so opening a book and
 * closing it builds library > book > library > book ... and a back-swipe walks
 * through every one of them. Here, when the app has an earlier entry of its
 * own we go back to it; otherwise (a book opened from a bookmark or a shared
 * link) the screen is replaced with the library, so the library is always the
 * bottom of the stack and a further back-swipe leaves the app, not loops in it.
 *
 * It stays a real link (href, middle-click, open in new tab all still work).
 */
export function BackLink({ className, children, "aria-label": ariaLabel }: BackLinkProps) {
  const router = useRouter();
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
    if (modified || e.defaultPrevented) return;
    if (router.history.canGoBack()) {
      e.preventDefault();
      router.history.back();
    }
    // Otherwise the Link below navigates, and `replace` keeps the stack flat.
  };
  return (
    <Link to="/" replace className={className} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </Link>
  );
}
