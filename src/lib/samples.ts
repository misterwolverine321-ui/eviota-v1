export interface SampleBook {
  url: string;
  fileName: string;
}

export const SAMPLE_BOOKS: SampleBook[] = [
  { url: "samples/alice.epub", fileName: "alice-in-wonderland.epub" },
  { url: "samples/tell-tale-heart.epub", fileName: "the-tell-tale-heart.epub" },
  { url: "samples/walden.epub", fileName: "walden.epub" },
];
