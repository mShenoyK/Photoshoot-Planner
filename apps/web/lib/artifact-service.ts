import { randomUUID } from "node:crypto";
import {
  artifactRequestSchema,
  artifactSchema,
  type Artifact,
} from "@framecraft/shared/artifacts";
import type { TaskJob } from "@framecraft/shared/knowledge";
import { poseIllustrator, type PoseIllustrationProvider } from "@framecraft/ai";
import { withShoot, InputError } from "./input-repository";
import { objectStore } from "./object-store";
import { exportBytes, digest } from "./exporters";
import { validateIllustration, poseSvg } from "./pose-svg";
import {
  validateSources,
  takeKnowledgeLease,
  releaseKnowledgeLease,
} from "./knowledge-service";
import { allReferences } from "./planning-service";
import { stylingInputHash } from "./styling-service";
const formats = {
  MARKDOWN: { extension: "md", mime: "text/markdown; charset=utf-8" },
  CSV: { extension: "csv", mime: "text/csv; charset=utf-8" },
  PDF: { extension: "pdf", mime: "application/pdf" },
  SVG: { extension: "svg", mime: "image/svg+xml" },
  ZIP: { extension: "zip", mime: "application/zip" },
  ILLUSTRATION: { extension: "svg", mime: "image/svg+xml" },
};
export function publicArtifact(a: Artifact) {
  const { storageKey, ...safe } = a;
  void storageKey;
  return safe;
}
export const listArtifacts = (owner: string, id: string) =>
  withShoot(owner, id, (s) => (s.artifacts ?? []).map(publicArtifact));
export async function createArtifact(
  owner: string,
  job: TaskJob,
  provider?: PoseIllustrationProvider,
): Promise<Record<string, unknown>> {
  const id = job.shootId;
  if (!id) throw new InputError("INVALID_JOB", "Missing shoot.");
  const req = artifactRequestSchema.parse({
    ...job.input,
    idempotencyKey: job.idempotencyKey,
  });
  const snapshot = await withShoot(owner, id, (s, shoot) => {
    const existing = s.artifacts?.find((a) => a.jobId === job.id);
    if (existing) return { existing };
    const plan = s.plans?.find((p) => p.id === req.planId);
    if (!plan) throw new InputError("NOT_FOUND", "Plan not found.", 404);
    const styling = req.stylingRevision
      ? s.styling?.find((v) => v.revision === req.stylingRevision)
      : undefined;
    if (req.stylingRevision && !styling)
      throw new InputError("NOT_FOUND", "Styling revision not found.", 404);
    if (
      styling &&
      ((styling.lighting &&
        styling.lightingInputHash !== stylingInputHash(s, shoot)) ||
        (styling.wardrobe &&
          styling.wardrobeInputHash !== stylingInputHash(s, shoot)))
    )
      throw new InputError(
        "STALE_INPUTS",
        "Regenerate styling after input changes, or export without styling.",
        409,
      );
    if (plan.genericFallback && req.format === "ILLUSTRATION")
      throw new InputError(
        "PROFILES_REQUIRED",
        "Confirm exact manual profiles and regenerate the plan first.",
      );
    return {
      plan: structuredClone(plan),
      styling: structuredClone(styling),
      title: shoot.name,
      inputHash: stylingInputHash(s, shoot),
      subjects: s.subjects.map((p) => ({
        id: p.id,
        ageGroup: p.ageGroup,
        ...(p.ageYears !== undefined ? { ageYears: p.ageYears } : {}),
      })),
      illustrations: (s.artifacts ?? []).filter(
        (a) => a.planId === plan.id && a.format === "ILLUSTRATION",
      ),
    };
  });
  if (snapshot.existing) return { artifact: publicArtifact(snapshot.existing) };
  const plan = snapshot.plan!;
  let bytes: Uint8Array;
  let usedProvider = "deterministic-export-v1";
  await takeKnowledgeLease(owner, job.id, {
    query: "export provenance verification",
    filters: {},
    maxResults: 1,
  });
  try {
    if (!(await validateSources(owner, allReferences(plan))))
      throw new InputError(
        "SOURCE_UNAVAILABLE",
        "A cited source is no longer available; revise the plan before creating a shareable export.",
        409,
      );
    if (req.format === "ILLUSTRATION") {
      const pose = plan.poses.find((p) => p.id === req.poseId);
      if (!pose) throw new InputError("NOT_FOUND", "Pose not found.", 404);
      if (
        JSON.stringify([...pose.subjectIds].sort()) !==
        JSON.stringify(snapshot.subjects!.map((s) => s.id).sort())
      )
        throw new InputError(
          "STALE_INPUTS",
          "Profiles changed; regenerate the plan before illustrating.",
          409,
        );
      const young = snapshot.subjects!.some(
        (s) =>
          ["BABY", "TODDLER"].includes(s.ageGroup) ||
          (s.ageYears !== undefined && s.ageYears < 3),
      );
      if (
        young &&
        /\b(suspend from|balance alone|stand on|jump off|climb on|unsupported infant)\b/i.test(
          [pose.subjectArrangement, ...pose.stepByStepDirections].join(" "),
        )
      )
        throw new InputError(
          "ILLUSTRATION_SAFETY",
          "Review this pose for supported child safety before illustrating.",
        );
      const input = {
        pose: {
          id: pose.id,
          title: pose.title,
          subjectArrangement: pose.subjectArrangement,
          stepByStepDirections: pose.stepByStepDirections,
        },
        subjects: snapshot.subjects!,
      };
      const adapter = provider ?? poseIllustrator();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          adapter.generate(input),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new InputError(
                    "PROVIDER_TIMEOUT",
                    "Illustration timed out. Retry.",
                  ),
                ),
              15000,
            );
          }),
        ]);
        bytes = Buffer.from(poseSvg(validateIllustration(raw, input), input));
      } finally {
        clearTimeout(timer);
      }
      usedProvider = adapter.name;
    } else {
      const illustrations = [];
      for (const a of snapshot.illustrations ?? []) {
        const data = await objectStore().get(a.storageKey);
        if (digest(data) !== a.sha256)
          throw new InputError(
            "INTEGRITY_FAILED",
            "An illustration failed integrity validation.",
            409,
          );
        illustrations.push({
          fileName: a.fileName,
          bytes: data,
          sha256: a.sha256,
        });
      }
      if (req.format === "SVG" && !snapshot.styling?.lighting)
        throw new InputError(
          "LIGHTING_REQUIRED",
          "Select a saved lighting revision.",
        );
      bytes = await exportBytes(
        {
          plan,
          styling: snapshot.styling,
          title: snapshot.title!,
          createdAt: job.createdAt,
          illustrations,
        },
        req.format,
      );
    }
    const f = formats[req.format];
    const artifact = artifactSchema.parse({
      id: job.id,
      jobId: job.id,
      shootId: id,
      planId: plan.id,
      planVersion: plan.version,
      stylingRevision: req.stylingRevision,
      poseId: req.poseId,
      format: req.format,
      fileName: `${req.format === "ILLUSTRATION" ? "pose" : "shoot"}-${job.id}.${f.extension}`,
      mime: f.mime,
      bytes: bytes.length,
      sha256: digest(bytes),
      storageKey: `shoots/${id}/outputs/${job.id}/${req.format.toLowerCase()}.${f.extension}`,
      createdAt: job.createdAt,
      provider: usedProvider,
    });
    return await withShoot(owner, id, async (s, shoot) => {
      if (stylingInputHash(s, shoot) !== snapshot.inputHash)
        throw new InputError(
          "STALE_INPUTS",
          "Shoot inputs changed during generation. Retry against current inputs.",
          409,
        );
      const prior = s.artifacts?.find((a) => a.jobId === job.id);
      if (prior) return { artifact: publicArtifact(prior) };
      // Immutable create. Recovery may reuse an existing identical object, never replace it.
      try {
        await objectStore().put(artifact.storageKey, bytes, artifact.mime);
      } catch (e) {
        let old: Uint8Array;
        try {
          old = await objectStore().get(artifact.storageKey);
        } catch {
          throw e;
        }
        if (digest(old) !== artifact.sha256)
          throw new InputError(
            "ARTIFACT_COLLISION",
            "Immutable output exists with different bytes.",
            409,
          );
      }
      s.artifacts ??= [];
      s.artifacts.push(artifact);
      return { artifact: publicArtifact(artifact) };
    });
  } finally {
    await releaseKnowledgeLease(owner, job.id);
  }
}
export async function downloadArtifact(
  owner: string,
  id: string,
  artifactId: string,
) {
  const refs = await withShoot(owner, id, (s) => {
    const a = s.artifacts?.find((a) => a.id === artifactId);
    if (!a) throw new InputError("NOT_FOUND", "Artifact not found.", 404);
    const p = s.plans?.find((p) => p.id === a.planId);
    if (!p) throw new InputError("NOT_FOUND", "Plan not found.", 404);
    return allReferences(p);
  });
  const lease = randomUUID();
  if (refs.length)
    await takeKnowledgeLease(owner, lease, {
      query: "download provenance verification",
      filters: {},
      maxResults: 1,
    });
  try {
    if (!(await validateSources(owner, refs)))
      throw new InputError(
        "SOURCE_UNAVAILABLE",
        "A cited source is no longer available. Revise and export again.",
        409,
      );
    return await withShoot(owner, id, async (s) => {
      const a = s.artifacts?.find((a) => a.id === artifactId);
      if (!a) throw new InputError("NOT_FOUND", "Artifact not found.", 404);
      const plan = s.plans?.find((p) => p.id === a.planId);
      if (!plan) throw new InputError("NOT_FOUND", "Plan not found.", 404);
      // Historical files are owner-private; no public sharing URLs are issued.
      const bytes = await objectStore().get(a.storageKey);
      if (digest(bytes) !== a.sha256)
        throw new InputError(
          "INTEGRITY_FAILED",
          "Artifact integrity check failed.",
          409,
        );
      return { artifact: a, bytes };
    });
  } finally {
    if (refs.length) await releaseKnowledgeLease(owner, lease);
  }
}
