import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { zipSync } from "fflate";
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { ShootPlan } from "@framecraft/shared/planning";
import type { Styling } from "@framecraft/shared/styling";
import { renderLightingSvg } from "@framecraft/shared/lighting-svg";
export const digest = (b: Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
export type ExportInput = {
  plan: ShootPlan;
  styling?: Styling;
  title: string;
  createdAt: string;
  generatedImages?: {
    fileName: string;
    provider: string;
    target: unknown;
    review: unknown;
  }[];
  illustrations?: { fileName: string; bytes: Uint8Array; sha256: string }[];
};
const md = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#+!|~]/g, "\\$&");
export function markdown(input: ExportInput): string {
  const { plan: p, styling: s } = input;
  const lines = [
    `# ${md(input.title)}`,
    `Plan version ${p.version}; styling revision ${s?.revision ?? "none"}.`,
    "Private planning brief. Contains participant labels and user-entered planning notes; review before sharing. Subject photos and source documents are excluded.",
    "## Creative brief",
    p.creativeBrief.concept,
    p.creativeBrief.narrative,
    ...p.creativeBrief.mood,
    ...p.creativeBrief.compositionGoals,
    ...p.creativeBrief.venueConsiderations,
  ].map((s, i) => (i < 5 ? s : md(s)));
  for (const pose of p.poses) {
    lines.push(
      `## Pose: ${md(pose.title)}`,
      md(pose.subjectArrangement),
      ...pose.stepByStepDirections.map((s) => `- ${md(s)}`),
      ...pose.ageSafetyNotes.map((s) => `- Safety: ${md(s)}`),
      `Why: ${md(pose.whyItWorks)}`,
      `Framing: ${md(pose.framing)}`,
      `Camera: ${md(pose.cameraHeight)}; ${md(pose.lensGuidance)}`,
      ...pose.expressionsAndInteractions.map(md),
    );
    for (const n of pose.sourceNotes)
      lines.push(`Reviewed source principle: ${md(n.summary)}`);
    for (const r of pose.sourceReferences)
      lines.push(
        `Source: ${md(r.documentTitle)}; document ${r.documentId}; chunk ${r.chunkId}; revision ${r.chunkRevision}; pages ${r.pageStart ?? "n/a"}–${r.pageEnd ?? "n/a"}; lines ${r.lineStart ?? "n/a"}–${r.lineEnd ?? "n/a"}.`,
      );
  }
  lines.push(
    "## Shot list",
    ...p.shotList.map(
      (x) =>
        `- ${x.completed ? "[x]" : "[ ]"} ${x.priority}: ${md(x.description)} (${x.estimatedMinutes} min)`,
    ),
  );
  if (s?.lighting) {
    lines.push(
      "## Lighting",
      md(s.lighting.title),
      ...Object.entries(s.lighting.settings).map(([k, v]) => `${k}: ${md(v)}`),
      ...s.lighting.notes.map((n) => `- ${md(n)}`),
      md(s.lighting.provenance),
      "Top and side SVG diagrams are included in the ZIP.",
    );
  }
  if (s?.wardrobe) {
    lines.push(
      "## Wardrobe",
      md(s.wardrobe.palette.join(" · ")),
      md(s.wardrobe.rationale),
    );
    for (const l of s.wardrobe.looks) {
      lines.push(`### ${md(l.label)}`);
      for (const c of l.candidates)
        lines.push(
          `#### ${md(c.name)}${c.id === l.selectedId ? " (selected)" : ""}${l.locked && c.id === l.selectedId ? " (locked)" : ""}`,
          md(c.color),
          ...c.garments.map(md),
          ...c.accessories.map(md),
          md(c.rationale),
          md(c.suitability),
          md(c.comfort),
          md(c.alternatives),
        );
    }
    for (const note of s.wardrobe.sourceNotes ?? [])
      lines.push(
        md(
          `${note.summary} — ${note.reference.documentTitle}, PDF page ${note.reference.pageStart}, chunk ${note.reference.chunkId}, review ${note.reference.chunkRevision}`,
        ),
      );
    lines.push(md(s.wardrobe.provenance));
  }
  lines.push(
    "## Equipment and contingencies",
    ...p.equipmentChecklist.map(md),
    ...p.contingencyPlan.map(md),
    "## Limitations",
    ...p.limitations.map(md),
    "Original schematic illustrations are optional and require a separate on-demand action. No photographic likeness is claimed.",
  );
  return lines.join("\n\n") + "\n";
}
export function shotCsv(p: ShootPlan): string {
  const cell = (v: string) =>
    `"${
      (/^[=+@-]/.test(
        [...v]
          .filter((c) => c.charCodeAt(0) > 31)
          .join("")
          .trimStart(),
      )
        ? "'"
        : "") + v.replaceAll('"', '""')
    }"`;
  return (
    "\uFEFF" +
    [
      ["ID", "Priority", "Pose ID", "Description", "Minutes", "Completed"],
      ...p.shotList.map((s) => [
        s.id,
        s.priority,
        s.poseId ?? "",
        s.description,
        String(s.estimatedMinutes),
        String(s.completed),
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
export async function pdfBrief(input: ExportInput): Promise<Uint8Array> {
  if (
    Buffer.byteLength(
      JSON.stringify({ plan: input.plan, styling: input.styling }),
      "utf8",
    ) >
    512 * 1024
  )
    throw new Error("EXPORT_INPUT_LIMIT");
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(input.createdAt));
  doc.setModificationDate(new Date(input.createdAt));
  doc.setTitle("FrameCraft private shoot brief");
  doc.setProducer("FrameCraft export v1");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 792;
  const printable = (s: string) =>
    [...s.normalize("NFKD")]
      .map((c) => {
        try {
          font.encodeText(c);
          return c;
        } catch {
          return `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`;
        }
      })
      .join("");
  const draw = (line: string) => {
    if (y < 48) {
      if (doc.getPageCount() >= 150) throw new Error("EXPORT_PAGE_LIMIT");
      page = doc.addPage([595, 842]);
      y = 792;
    }
    page.drawText(line, {
      x: 40,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.18, 0.14),
    });
    y -= 15;
  };
  draw("Private shoot brief - review before sharing. Photos excluded.");
  draw(
    "Unsupported font glyphs use U+ codes; Markdown preserves full Unicode.",
  );
  for (const line of markdown(input).split("\n")) {
    let rest = printable(line);
    if (!rest) {
      y -= 7;
      continue;
    }
    while (rest.length) {
      let n = Math.min(rest.length, 130);
      while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), 10) > 515) n--;
      if (n < rest.length) {
        const space = rest.lastIndexOf(" ", n);
        if (space > n / 2) n = space;
      }
      draw(rest.slice(0, n));
      rest = rest.slice(n).trimStart();
    }
  }
  const diagrams = input.styling?.lighting
    ? (["top", "side"] as const).map((view) => ({
        fileName: `lighting-${view}.svg`,
        bytes: Buffer.from(
          renderLightingSvg(input.styling!.lighting!.scene, view),
        ),
        sha256: "",
      }))
    : [];
  for (const figure of [...diagrams, ...(input.illustrations ?? [])]) {
    const png = await sharp(figure.bytes)
      .resize({ width: 1200, height: 900, fit: "inside" })
      .png()
      .toBuffer();
    const image = await doc.embedPng(png);
    const p = doc.addPage([595, 842]);
    p.drawText(figure.fileName, { x: 40, y: 792, size: 12, font });
    const scale = Math.min(515 / image.width, 700 / image.height);
    p.drawImage(image, {
      x: 40,
      y: 780 - image.height * scale,
      width: image.width * scale,
      height: image.height * scale,
    });
  }
  return doc.save({ useObjectStreams: false });
}
export async function exportBytes(
  input: ExportInput,
  format: "MARKDOWN" | "CSV" | "PDF" | "SVG" | "ZIP",
) {
  const b = (s: string) => Buffer.from(s, "utf8");
  if (format === "MARKDOWN") return b(markdown(input));
  if (format === "CSV") return b(shotCsv(input.plan));
  if (format === "PDF") return pdfBrief(input);
  if (format === "SVG") {
    if (!input.styling?.lighting) throw new Error("LIGHTING_REQUIRED");
    return b(renderLightingSvg(input.styling.lighting.scene, "top"));
  }
  const files: Record<string, Uint8Array> = {
    "shoot-plan.md": b(markdown(input)),
    "shot-list.csv": b(shotCsv(input.plan)),
    "shoot-plan.pdf": await pdfBrief(input),
  };
  if (input.styling?.lighting) {
    files["lighting-top.svg"] = b(
      renderLightingSvg(input.styling.lighting.scene, "top"),
    );
    files["lighting-side.svg"] = b(
      renderLightingSvg(input.styling.lighting.scene, "side"),
    );
    files["lighting-scene.json"] = b(
      JSON.stringify(input.styling.lighting.scene, null, 2),
    );
  }
  for (const f of input.illustrations ?? [])
    files[`illustrations/${f.fileName}`] = f.bytes;
  const refs = input.plan.poses
    .flatMap((p) => p.sourceReferences)
    .concat(input.plan.lighting.flatMap((l) => l.sourceReferences))
    .concat(
      (input.styling?.wardrobe?.sourceNotes ?? []).map((n) => n.reference),
    );
  const manifest = {
    schemaVersion: 1,
    createdAt: input.createdAt,
    planId: input.plan.id,
    planVersion: input.plan.version,
    stylingRevision: input.styling?.revision ?? null,
    provider: input.plan.provider,
    sourceReferences: refs,
    generatedImages: input.generatedImages ?? [],
    lightingProvenance: input.styling?.lighting?.provenance ?? null,
    wardrobeProvenance: input.styling?.wardrobe?.provenance ?? null,
    exclusions: [
      "subject photographs",
      "all original uploads",
      "source books and thumbnails",
      "consent records",
      "credentials",
    ],
    privacy:
      "Manual planning text and participant labels may be identifying. Review before sharing.",
    files: Object.entries(files).map(([name, bytes]) => ({
      name,
      bytes: bytes.length,
      sha256: digest(bytes),
    })),
  };
  files["manifest.json"] = b(JSON.stringify(manifest, null, 2));
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [
        k,
        [v, { mtime: new Date("2020-01-01T00:00:00Z") }],
      ]),
    ),
    { level: 6 },
  );
}
