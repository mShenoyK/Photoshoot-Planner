import {
  illustrationSceneSchema,
  type IllustrationScene,
} from "@framecraft/shared/artifacts";
import type { IllustrationInput } from "@framecraft/ai";
import { InputError } from "./input-repository";
export const xmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function validateIllustration(
  raw: unknown,
  input: IllustrationInput,
): IllustrationScene {
  const scene = illustrationSceneSchema.parse(raw);
  const actual = scene.figures.map((f) => f.subjectId).sort();
  const expected = input.subjects.map((s) => s.id).sort();
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    new Set(actual).size !== actual.length
  )
    throw new InputError(
      "ILLUSTRATION_COUNT",
      "Provider returned the wrong subjects.",
    );
  for (const f of scene.figures) {
    const s = input.subjects.find((s) => s.id === f.subjectId)!;
    const young =
      ["BABY", "TODDLER"].includes(s.ageGroup) ||
      (s.ageYears !== undefined && s.ageYears < 3);
    if (young && f.support !== "CAREGIVER_SUPPORTED")
      throw new InputError(
        "ILLUSTRATION_SAFETY",
        "Young children must have caregiver support.",
      );
    if (
      f.support === "CAREGIVER_SUPPORTED" &&
      !input.subjects.some(
        (a) =>
          a.id === f.guardianId &&
          ["ADULT", "SENIOR"].includes(a.ageGroup) &&
          (a.ageYears === undefined || a.ageYears >= 18),
      )
    )
      throw new InputError(
        "ILLUSTRATION_SAFETY",
        "Add an adult caregiver profile before illustrating a baby or toddler.",
      );
  }
  return scene;
}
export function poseSvg(
  scene: IllustrationScene,
  input: IllustrationInput,
): string {
  const e = xmlEscape;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" role="img" aria-labelledby="title desc"><title id="title">${e(input.pose.title)}</title><desc id="desc">Original mock schematic; exactly ${scene.figures.length} subjects. Supported seating and caregiver links, not a photographic likeness or a pose-specific limb simulation.</desc><rect width="1000" height="500" fill="#faf8f2"/><text x="25" y="35" font-size="22" fill="#172d24">Original schematic · ${scene.figures.length} subjects</text>${scene.figures
    .map((f, i) => {
      const supported = f.support === "CAREGIVER_SUPPORTED";
      const y = supported ? f.y + 40 : f.y;
      const guardian = scene.figures.find((a) => a.subjectId === f.guardianId);
      return `<g data-subject="${e(f.subjectId)}"><circle cx="${f.x}" cy="${y - 25}" r="${supported ? 13 : 20}" fill="#365d4d"/><path d="M${f.x} ${y} v${supported ? 30 : 60} m-20 0 h40" fill="none" stroke="#365d4d" stroke-width="12"/><path d="M${f.x - 25} ${y + 65} h50 v35" fill="none" stroke="#956525" stroke-width="5"/>${guardian ? `<path d="M${f.x} ${y + 30} L${guardian.x} ${guardian.y + 45}" fill="none" stroke="#536b60" stroke-dasharray="5 4"/>` : ""}<text x="${Math.min(f.x - 25, 860)}" y="360" font-size="15">Subject ${i + 1}</text><text x="${Math.min(f.x - 25, 820)}" y="385" font-size="12">${supported ? "Caregiver support" : "Stable seat"}</text></g>`;
    })
    .join(
      "",
    )}<text x="25" y="440" font-size="15">Support and spacing reference. Follow the written pose card and confirm comfort.</text><text x="25" y="470" font-size="14">No source illustrations or subject photographs used. Illustrative geometry; review before use.</text></svg>`;
}
