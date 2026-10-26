import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { blockedTotal, removedRows, type RemoteKind } from "@/lib/safe-document";
import { resolveExternalLink, usePendingLink, useSafeReport } from "@/lib/safe-report";
import { IconButton } from "./ui";

const KIND_LABEL: Record<RemoteKind, string> = {
  image: "Image",
  style: "Stylesheet or font",
  media: "Audio or video",
  frame: "Frame",
  other: "Other",
};

const MAX_REMOTE = 12;
const MAX_LINKS = 8;

/** Header button that opens the safe-reading panel. */
export function SafeReadingButton() {
  const report = useSafeReport();
  const [open, setOpen] = useState(false);
  const total = blockedTotal(report);
  const remote = report.remote.slice(0, MAX_REMOTE);
  const links = report.links.slice(0, MAX_LINKS);
  const rows = removedRows(report);

  return (
    <>
      <IconButton
        onClick={() => setOpen(true)}
        label={total > 0 ? `Safe reading: ${total} blocked in this book` : "Safe reading"}
        active={open}
      >
        <span className="relative flex">
          <ShieldCheck className="h-4 w-4" />
          {total > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-2 -right-2.5 min-w-4 rounded-full bg-signal px-1 text-center text-[10px] leading-4 font-medium text-signal-foreground"
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </span>
      </IconButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Safe reading</DialogTitle>
            <DialogDescription>
              Books are untrusted files. This one is shown with scripts removed and remote content
              blocked, and links open only after you confirm.
            </DialogDescription>
          </DialogHeader>

          <section aria-labelledby="safe-removed" className="space-y-2">
            <h3 id="safe-removed" className="text-sm font-medium">
              Removed from this book
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing so far. Each section is checked as you reach it, so this list can grow.
              </p>
            ) : (
              <ul className="divide-y divide-border border border-border text-sm">
                {rows.map((row) => (
                  <li key={row.label} className="flex justify-between gap-4 px-3 py-2">
                    <span>{row.label}</span>
                    <span className="tabular-nums">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {report.remote.length > 0 && (
            <section aria-labelledby="safe-remote" className="space-y-2">
              <h3 id="safe-remote" className="text-sm font-medium">
                Remote content not loaded ({report.remote.length})
              </h3>
              <p className="text-sm text-muted-foreground">
                These addresses would have been contacted just by opening the book. Nothing was
                requested.
              </p>
              <ul className="space-y-1.5 text-xs">
                {remote.map((ref) => (
                  <li key={ref.url}>
                    <span className="text-muted-foreground">{KIND_LABEL[ref.kind]}: </span>
                    <span className="font-mono break-all">{ref.url}</span>
                  </li>
                ))}
              </ul>
              {report.remote.length > remote.length && (
                <p className="text-xs text-muted-foreground">
                  and {report.remote.length - remote.length} more
                </p>
              )}
            </section>
          )}

          {report.links.length > 0 && (
            <section aria-labelledby="safe-links" className="space-y-2">
              <h3 id="safe-links" className="text-sm font-medium">
                Links to other places ({report.links.length})
              </h3>
              <ul className="space-y-1.5 text-xs">
                {links.map((url) => (
                  <li key={url} className="font-mono break-all">
                    {url}
                  </li>
                ))}
              </ul>
              {report.links.length > links.length && (
                <p className="text-xs text-muted-foreground">
                  and {report.links.length - links.length} more
                </p>
              )}
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            Covers EPUB, MOBI/AZW3, HTML and Markdown. There is no setting to allow remote content.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Asks before any link in a book leaves the app. Mount once in the reader. */
export function ExternalLinkGuard() {
  const link = usePendingLink();
  const opensApp = link?.host === "mailto" || link?.host === "tel";
  const who = link?.by === "app" ? "Eviota" : "This book";

  return (
    <AlertDialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) resolveExternalLink(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open this link?</AlertDialogTitle>
          <AlertDialogDescription>
            {opensApp
              ? `${who} wants to open a ${link?.host} link in another app.`
              : `${who} wants to open a page on ${link?.host}. That leaves Eviota, and the site will see your visit.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="font-mono text-xs break-all">{link?.url}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay here</AlertDialogCancel>
          <AlertDialogAction onClick={() => resolveExternalLink(true)}>Open link</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
