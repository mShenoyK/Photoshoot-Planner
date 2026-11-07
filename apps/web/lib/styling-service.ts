import { approvedReferences } from "./reference-service";
import { createHash } from "node:crypto";
import {
  stylingActionSchema,
  stylingSchema,
  type Styling,
} from "@framecraft/shared/styling";
import { withShoot, InputError } from "./input-repository";
import { lightingRules, wardrobeRules } from "./styling-rules";
import type { InputState } from "@framecraft/shared/inputs";
import type { Shoot } from "@framecraft/shared";
export const stylingInputHash = (state: InputState, shoot: Shoot) =>
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
        references: approvedReferences(state),
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
        latest.lightingInputHash !== stylingInputHash(state, shoot)) ||
        (!!latest.wardrobe &&
          latest.wardrobeInputHash !== stylingInputHash(state, shoot))),
    subjects: state.subjects.map((p) => ({ id: p.id, label: p.label })),
  };
}
export const readStyling = (owner: string, id: string) =>
  withShoot(owner, id, (s, shoot) => stylingView(s, shoot));
export async function changeStyling(owner: string, id: string, body: unknown) {
  const action = stylingActionSchema.parse(body);
  return withShoot(owner, id, (state, shoot) => {
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
    if (
      old &&
      sectionHash !== next.inputHash &&
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
      next.lightingInputHash = next.inputHash;
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
        state,
        old?.wardrobe,
        action.heroSubjectId,
      );
      next.wardrobeInputHash = next.inputHash;
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
}
