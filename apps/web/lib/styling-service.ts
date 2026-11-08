import { ensureBuiltinKnowledge } from "./builtin-knowledge";
import {
  takeKnowledgeLease,
  releaseKnowledgeLease,
  validateSources,
} from "./knowledge-service";
import { randomUUID } from "node:crypto";
import type { KnowledgeHit } from "@framecraft/shared/knowledge";
import { approvedReferences } from "./reference-service";
import { createHash } from "node:crypto";
import {
  stylingActionSchema,
  stylingSchema,
  type Styling,
} from "@framecraft/shared/styling";
import { withShoot, InputError } from "./input-repository";
import { lightingRules, wardrobeRules } from "./styling-rules";
import type { InputState, ReferenceScope } from "@framecraft/shared/inputs";
import type { Shoot } from "@framecraft/shared";
export const stylingInputHash = (
  state: InputState,
  shoot: Shoot,
  scope?: ReferenceScope,
  knowledgeOnly = false,
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        shoot,
        subjects: state.subjects.map(({ consent, consentHistory, ...p }) => {
          void consent;
          void consentHistory;
          return p;
        }),
        kit: state.cameraKit,
        references: knowledgeOnly ? [] : approvedReferences(state, scope),
      }),
    )
    .digest("hex");
export function stylingView(state: InputState, shoot: Shoot) {
  const versions = state.styling ?? [];
  const latest = versions.at(-1) ?? null;
  return {
    latest,
    versions,
    stale:
      !!latest &&
      ((!!latest.lighting &&
        latest.lightingInputHash !==
          stylingInputHash(state, shoot, "LIGHTING")) ||
        (!!latest.wardrobe &&
          latest.wardrobeInputHash !==
            stylingInputHash(
              state,
              shoot,
              "WARDROBE",
              latest.wardrobe.knowledgeOnly,
            ))),
    subjects: state.subjects.map((p) => ({ id: p.id, label: p.label })),
  };
}
export const readStyling = async (
  owner: string,
  id: string,
): Promise<ReturnType<typeof stylingView> & { sourcesAvailable?: boolean }> => {
  const view = await withShoot(owner, id, (s, shoot) => stylingView(s, shoot));
  const refs = (view.latest?.wardrobe?.sourceNotes ?? []).map(
    (n) => n.reference,
  );
  return { ...view, sourcesAvailable: await validateSources(owner, refs) };
};
export async function changeStyling(owner: string, id: string, body: unknown) {
  const action = stylingActionSchema.parse(body);
  const lease = randomUUID();
  let knowledge: KnowledgeHit[] = [];
  if (action.action === "WARDROBE" && action.knowledgeOnly) {
    await withShoot(owner, id, () => true);
    await ensureBuiltinKnowledge(owner);
    knowledge = await takeKnowledgeLease(owner, lease, {
      query: "clothing outfit wardrobe group color harmony setting footwear",
      filters: { topics: ["WARDROBE"] },
      maxResults: 5,
    });
  }
  try {
    return await withShoot(owner, id, (state, shoot) => {
      state.styling ??= [];
      const old = state.styling.at(-1);
      if ((old?.revision ?? 0) !== action.baseRevision)
        throw new InputError(
          "CONFLICT",
          "Styling changed elsewhere. Reload before editing.",
          409,
        );
      const next: Styling = {
        ...structuredClone(old),
        revision: (old?.revision ?? 0) + 1,
        createdAt: new Date().toISOString(),
        inputHash: stylingInputHash(state, shoot),
      };
      const sectionHash =
        action.action === "SCENE"
          ? old?.lightingInputHash
          : old?.wardrobeInputHash;
      const currentSectionHash =
        action.action === "SCENE"
          ? stylingInputHash(state, shoot, "LIGHTING")
          : stylingInputHash(
              state,
              shoot,
              "WARDROBE",
              old?.wardrobe?.knowledgeOnly,
            );
      if (
        old &&
        sectionHash !== currentSectionHash &&
        action.action !== "LIGHTING" &&
        action.action !== "WARDROBE" &&
        !(
          action.action === "SELECT" &&
          !action.locked &&
          old.wardrobe?.looks.find((l) => l.subjectId === action.subjectId)
            ?.selectedId === action.candidateId
        )
      )
        throw new InputError(
          "STALE_INPUTS",
          "Shoot inputs changed. Regenerate this section before editing.",
          409,
        );
      if (action.action === "LIGHTING") {
        next.lighting = lightingRules(shoot, state, action.recipe, action.fill);
        next.lightingInputHash = stylingInputHash(state, shoot, "LIGHTING");
      }
      if (action.action === "SCENE") {
        if (!next.lighting)
          throw new InputError("NOT_READY", "Generate lighting first.");
        const expected = state.subjects.length
          ? state.subjects.map((p) => p.id)
          : Array.from(
              { length: shoot.subjectCount ?? 1 },
              (_, i) => `generic-${i + 1}`,
            );
        if (
          expected.length !== action.scene.subjects.length ||
          expected.some((id) => !action.scene.subjects.some((p) => p.id === id))
        )
          throw new InputError(
            "SUBJECT_MISMATCH",
            "The scene must contain exactly the shoot subjects.",
          );
        const flashes = action.scene.lights.filter(
          (l) => l.kind === "FLASH",
        ).length;
        if (flashes > (state.cameraKit?.flashCount ?? 0))
          throw new InputError(
            "EQUIPMENT_MISMATCH",
            "The scene uses more flashes than the selected kit.",
          );
        next.lighting.scene = action.scene;
      }
      if (action.action === "WARDROBE") {
        next.wardrobe = wardrobeRules(
          shoot,
          action.knowledgeOnly
            ? { ...state, referenceReviews: [], media: [] }
            : state,
          action.knowledgeOnly
            ? {
                ...old?.wardrobe,
                looks:
                  old?.wardrobe?.looks.filter(
                    (l) => !l.sourceAssetId && !l.sourceReferenceId,
                  ) ?? [],
                palette: old?.wardrobe?.palette ?? ["cream"],
                observations: [],
                rationale: "",
                provenance: "",
              }
            : old?.wardrobe,
          action.heroSubjectId,
        );
        next.wardrobe.knowledgeOnly = action.knowledgeOnly;
        next.wardrobe.sourceNotes = knowledge.map((hit) => ({
          reference: hit.sourceReference,
          summary: hit.summary,
        }));
        if (action.knowledgeOnly) {
          next.wardrobe.provenance =
            "Knowledge-only: reviewed original PDF notes and stated preferences. No image observations used.";
          next.wardrobe.rationale +=
            " " +
            (knowledge.length
              ? "Use the reviewed coordination principles below to choose a setting, discuss formality and include footwear when framing full length. Palette and fit choices remain suggestions to confirm with each participant."
              : "No eligible wardrobe sources are available; these are uncited manual-profile suggestions.");
        }
        next.wardrobeInputHash = stylingInputHash(
          state,
          shoot,
          "WARDROBE",
          action.knowledgeOnly,
        );
      }
      if (action.action === "OBSERVATION" || action.action === "SELECT") {
        const subjectId =
          action.action === "OBSERVATION"
            ? action.observation.subjectId
            : action.subjectId;
        if (!state.subjects.some((p) => p.id === subjectId))
          throw new InputError("NOT_FOUND", "Subject not found.", 404);
        if (!next.wardrobe)
          throw new InputError("NOT_READY", "Generate wardrobe first.");
        if (action.action === "OBSERVATION") {
          next.wardrobe.observations = next.wardrobe.observations.filter(
            (o) => o.subjectId !== subjectId,
          );
          next.wardrobe.observations.push(action.observation);
          // Rationale changes are applied on explicit rebalance; locked looks are untouched.
        } else {
          const look = next.wardrobe.looks.find(
            (l) => l.subjectId === subjectId,
          )!;
          if (!look.candidates.some((c) => c.id === action.candidateId))
            throw new InputError(
              "NOT_FOUND",
              "Outfit not found for subject.",
              404,
            );
          if (look.locked && action.candidateId !== look.selectedId)
            throw new InputError(
              "LOCKED",
              "Unlock the outfit before swapping.",
              409,
            );
          look.selectedId = action.candidateId;
          look.locked = action.locked;
        }
      }
      const valid = stylingSchema.parse(next);
      state.styling.push(valid);
      return stylingView(state, shoot);
    });
  } finally {
    if (action.action === "WARDROBE" && action.knowledgeOnly)
      await releaseKnowledgeLease(owner, lease);
  }
}
