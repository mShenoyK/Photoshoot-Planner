import { randomUUID, createHash } from "node:crypto";
import {
  taxonomySchema,
  type KnowledgeDocument,
} from "@framecraft/shared/knowledge";
import { assertCorpusMutable, withCorpus } from "./knowledge-repository";
/** Original reviewed notes from PDFs supplied on 2026-11-08. Page numbers are 1-based PDF pages, not printed folios. No copied passages or illustrations. */
export const builtinSources = [
  {
    title: "Master Posing Guide for Portrait Photographers",
    author: "J. D. Wacker",
    edition: "2002",
    sha256: "83902fa187cb6de900d31cc5ef2e9329314038c28768804acffe1c02303d17e8",
    pages: 129,
    notes: [
      {
        page: 15,
        topics: ["POSE", "SAFETY"] as const,
        summary:
          "Discuss participants' preferences before directing. Demonstrate a comfortable pose and adapt it to the person's natural posture rather than forcing an unfamiliar position.",
      },
      {
        page: 107,
        topics: ["POSE"] as const,
        summary:
          "For two people, arrange a comfortable shared composition and invite interaction they choose. Treat closeness as a preference; offer a no-contact variation.",
      },
      {
        page: 117,
        topics: ["POSE", "COMPOSITION"] as const,
        summary:
          "Keep a group's face planes close enough for the available depth of field. Check every face for focus and visibility before changing the arrangement.",
      },
    ],
  },
  {
    title: "Posing for Portrait Photography",
    author: "Jeff Smith",
    edition: "2004",
    sha256: "31f904dc36b4a8b42b30f63269ebe3ee9c1da938bb168a7c05f4ffe690d8d822",
    pages: 128,
    notes: [
      {
        page: 30,
        topics: ["WARDROBE", "COMPOSITION"] as const,
        summary:
          "Choose clothing formality with the intended setting and portrait mood in mind. Compare garment texture and background detail so the overall image feels coherent.",
      },
      {
        page: 32,
        topics: ["WARDROBE", "POSE"] as const,
        summary:
          "Coordinate outfit, pose and surroundings. In a busy setting, simplify the background or framing while retaining sufficient depth of field for the people.",
      },
      {
        page: 104,
        topics: ["WARDROBE", "POSE"] as const,
        summary:
          "Ask which looks the participant wants and does not want. Pair each selected outfit with a planned setting before the session, and vary direction when the outfit or mood changes.",
      },
    ],
  },
  {
    title: "The Portrait Photographer's Guide to Posing",
    author: "Bill Hurter",
    edition: "2nd edition, 2012",
    sha256: "4f20b41a43f9cf01d1130aca334eb3939ecfc55ab7241e9a74613a57b578a12c",
    pages: 129,
    notes: [
      {
        page: 91,
        topics: ["WARDROBE", "COMPOSITION"] as const,
        summary:
          "For a coordinated group, discuss a shared level of formality and a palette compatible with the surroundings. Simple patterns can reduce competing visual detail; identical clothes are optional.",
      },
      {
        page: 93,
        topics: ["WARDROBE"] as const,
        summary:
          "Include footwear when planning full-length portraits. Coordinate shoes with the outfit while giving comfort, safe footing and the participant's preferences priority.",
      },
      {
        page: 102,
        topics: ["POSE", "COMPOSITION"] as const,
        summary:
          "For four people, a gently staggered arrangement can make faces easier to distinguish. Keep everyone visible and comfortably supported; change camera framing instead of using unsafe elevations.",
      },
    ],
  },
];
export async function ensureBuiltinKnowledge(owner: string) {
  await withCorpus(
    owner,
    (corpus) => {
      const missing = builtinSources.filter(
        (source) => !corpus.documents.some((d) => d.sha256 === source.sha256),
      );
      if (!missing.length) return;
      assertCorpusMutable(corpus);
      for (const source of missing) {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const taxonomy = taxonomySchema.parse({
          topics: ["POSE", "WARDROBE", "COMPOSITION", "SAFETY"],
        });
        const document: KnowledgeDocument = {
          title: source.title,
          author: source.author,
          edition: source.edition,
          licenseStatus: "PRIVATE_REFERENCE",
          ingestionPermitted: true,
          allowDerivedUse: true,
          allowPrivateReview: false,
          allowPrivateVision: false,
          taxonomy,
          id,
          ownerId: owner,
          sha256: source.sha256,
          mime: "application/pdf",
          sourceFilename: `${source.title}.pdf`,
          storageKey: "",
          representation: "REVIEWED_NOTES",
          allowOriginalDisplay: false,
          scope: "PRIVATE_OWNER",
          status: "READY",
          pages: source.pages,
          imageOnlyPages: [],
          createdAt,
          lastChunkRevision: 1,
          chunks: source.notes.map((note) => ({
            id: createHash("sha256")
              .update(`${source.sha256}:${note.page}:${note.summary}`)
              .digest("hex"),
            documentId: id,
            text: note.summary,
            summary: note.summary,
            headingPath: ["Reviewed original notes"],
            pageStart: note.page,
            pageEnd: note.page,
            reviewStatus: "APPROVED",
            reviewerId: "framecraft-curated-2026-11-08",
            reviewedAt: createdAt,
            revision: 1,
            taxonomy: taxonomySchema.parse({ topics: [...note.topics] }),
          })),
        };
        corpus.documents.push(document);
      }
    },
    true,
  );
}
