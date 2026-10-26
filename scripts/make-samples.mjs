/**
 * Generates the three bundled sample EPUBs (public-domain texts) with
 * embedded covers from src/assets/covers. Run: bun scripts/make-samples.mjs
 */
import { zipSync, strToU8 } from "fflate";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "samples");
mkdirSync(outDir, { recursive: true });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BOOKS = [
  {
    slug: "alice",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    cover: "alice.jpg",
    chapters: [
      {
        title: "Down the Rabbit-Hole",
        paras: [
          "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice, “without pictures or conversations?”",
          "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
          "There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!” But when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it.",
          "In another moment down went Alice after it, never once considering how in the world she was to get out again. The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.",
        ],
      },
      {
        title: "The Pool of Tears",
        paras: [
          "“Curiouser and curiouser!” cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English); “now I'm opening out like the largest telescope that ever was! Good-bye, feet!”",
          "Just then her head struck against the roof of the hall: in fact she was now more than nine feet high, and she at once took up the little golden key and hurried off to the garden door.",
          "Poor Alice! It was as much as she could do, lying down on one side, to look through into the garden with one eye; but to get through was more hopeless than ever: she sat down and began to cry again.",
          "“You ought to be ashamed of yourself,” said Alice, “a great girl like you,” (she might well say this), “to go on crying in this way! Stop this moment, I tell you!” But she went on all the same, shedding gallons of tears, until there was a large pool all round her, about four inches deep and reaching half down the hall.",
        ],
      },
      {
        title: "A Caucus-Race and a Long Tale",
        paras: [
          "They were indeed a queer-looking party that assembled on the bank—the birds with draggled feathers, the animals with their fur clinging close to them, and all dripping wet, cross, and uncomfortable.",
          "The first question of course was, how to get dry again: they had a consultation about this, and after a few minutes it seemed quite natural to Alice to find herself talking familiarly with them, as if she had known them all her life.",
          "At last the Mouse, who seemed to be a person of authority among them, called out, “Sit down, all of you, and listen to me! I'll soon make you dry enough!”",
          "“What is a Caucus-race?” said Alice; not that she wanted much to know, but the Dodo had paused as if it thought that somebody ought to speak, and no one else seemed inclined to say anything. “Why,” said the Dodo, “the best way to explain it is to do it.”",
        ],
      },
    ],
  },
  {
    slug: "tell-tale-heart",
    title: "The Tell-Tale Heart",
    author: "Edgar Allan Poe",
    cover: "tell-tale-heart.jpg",
    chapters: [
      {
        title: "The Tell-Tale Heart",
        paras: [
          "True!—nervous—very, very dreadfully nervous I had been and am; but why will you say that I am mad? The disease had sharpened my senses—not destroyed—not dulled them. Above all was the sense of hearing acute. I heard all things in the heaven and in the earth. I heard many things in hell. How, then, am I mad? Hearken! and observe how healthily—how calmly I can tell you the whole story.",
          "It is impossible to say how first the idea entered my brain; but once conceived, it haunted me day and night. Object there was none. Passion there was none. I loved the old man. He had never wronged me. He had never given me insult. For his gold I had no desire. I think it was his eye! yes, it was this!",
          "He had the eye of a vulture—a pale blue eye, with a film over it. Whenever it fell upon me, my blood ran cold; and so by degrees—very gradually—I made up my mind to take the life of the old man, and thus rid myself of the eye forever.",
          "Now this is the point. You fancy me mad. Madmen know nothing. But you should have seen me. You should have seen how wisely I proceeded—with what caution—with what foresight—with what dissimulation I went to work! I was never kinder to the old man than during the whole week before I killed him.",
          "And every night, about midnight, I turned the latch of his door and opened it—oh so gently! And then, when I had made an opening sufficient for my head, I put in a dark lantern, all closed, closed, that no light shone out, and then I thrust in my head. Oh, you would have laughed to see how cunningly I thrust it in!",
        ],
      },
      {
        title: "The Night",
        paras: [
          "Upon the eighth night I was more than usually cautious in opening the door. A watch's minute hand moves more quickly than did mine. Never before that night had I felt the extent of my own powers—of my sagacity. I could scarcely contain my feelings of triumph.",
          "I had my head in, and was about to open the lantern, when my thumb slipped upon the tin fastening, and the old man sprang up in bed, crying out—“Who's there?”",
          "I kept quite still and said nothing. For a whole hour I did not move a muscle, and in the meantime I did not hear him lie down. He was still sitting up in the bed listening;—just as I have done, night after night, hearkening to the death watches in the wall.",
          "When I had waited a long time, very patiently, without hearing him lie down, I resolved to open a little—a very, very little crevice in the lantern. So I opened it—you cannot imagine how stealthily, stealthily—until, at length a simple dim ray, like the thread of the spider, shot from out the crevice and fell full upon the vulture eye.",
        ],
      },
    ],
  },
  {
    slug: "walden",
    title: "Walden",
    author: "Henry David Thoreau",
    cover: "walden.jpg",
    chapters: [
      {
        title: "Economy",
        paras: [
          "When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labor of my hands only. I lived there two years and two months. At present I am a sojourner in civilized life again.",
          "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
          "I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life.",
          "The mass of men lead lives of quiet desperation. What is called resignation is confirmed desperation. From the desperate city you go into the desperate country, and have to console yourself with the bravery of minks and muskrats.",
        ],
      },
      {
        title: "Where I Lived, and What I Lived For",
        paras: [
          "Every morning was a cheerful invitation to make my life of equal simplicity, and I may say innocence, with Nature herself. I have been as sincere a worshipper of Aurora as the Greeks.",
          "I got up early and bathed in the pond; that was a religious exercise, and one of the best things which I did. They say that characters were engraven on the bathing tub of King Tching-thang to this effect: “Renew thyself completely each day; do it again, and again, and forever again.”",
          "Morning brings back the heroic ages. I was as much affected by the faint hum of a mosquito making its invisible and unimaginable tour through my apartment at earliest dawn, as I could be by any trumpet that ever sang of fame.",
          "Still we live meanly, like ants; though the fable tells us that we were long ago changed into men. Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers, or in extreme cases he may add his ten toes, and lump the rest. Simplicity, simplicity, simplicity!",
        ],
      },
    ],
  },
];

const chapterXhtml = (book, ch) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>${esc(ch.title)}</title></head>
<body>
<section>
<h2>${esc(ch.title)}</h2>
${ch.paras.map((p) => `<p>${esc(p)}</p>`).join("\n")}
</section>
</body>
</html>`;

for (const book of BOOKS) {
  const files = {};

  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0 }];

  files["META-INF/container.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`,
    ...book.chapters.map(
      (_, i) =>
        `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n    ");

  const spine = book.chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("");

  files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:folio:sample:${book.slug}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(book.author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>${spine}</spine>
</package>`);

  files["OEBPS/nav.xhtml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${esc(book.title)}</title></head>
<body>
<nav epub:type="toc">
<h1>${esc(book.title)}</h1>
<ol>
${book.chapters.map((ch, i) => `<li><a href="ch${i + 1}.xhtml">${esc(ch.title)}</a></li>`).join("\n")}
</ol>
</nav>
</body>
</html>`);

  book.chapters.forEach((ch, i) => {
    files[`OEBPS/ch${i + 1}.xhtml`] = strToU8(chapterXhtml(book, ch));
  });

  files["OEBPS/cover.jpg"] = readFileSync(join(root, "src", "assets", "covers", book.cover));

  const zipped = zipSync(files);
  const out = join(outDir, `${book.slug}.epub`);
  writeFileSync(out, zipped);
  console.log(`wrote ${out} (${zipped.length} bytes)`);
}
