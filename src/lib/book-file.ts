/**
 * Give a stored book file the name recorded on its book.
 *
 * A file imported in this browser is stored as a `File` and keeps its name, but
 * a book put back by "Restore from file" is stored as a plain `Blob`. foliate-js
 * reads `file.name` to choose how to open a book, so a nameless Blob fails for
 * every format it handles (EPUB, MOBI, AZW3, FB2) with "Couldn't open this file".
 * A file that already has a name is returned as it is.
 */
export function asNamedFile(blob: Blob, fileName: string | undefined): Blob {
  if (!fileName) return blob;
  const name = (blob as { name?: unknown }).name;
  if (typeof name === "string" && name) return blob;
  return new File([blob], fileName, { type: blob.type });
}
