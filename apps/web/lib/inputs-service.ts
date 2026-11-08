import { randomUUID, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import {
  consentSchema,
  subjectSchema,
  requiresGuardian,
  uploadIntentSchema,
  type InputState,
  type Subject,
  type Consent,
  type UploadIntent,
  type MediaAsset,
} from "@framecraft/shared/inputs";
import { authKey } from "./auth";
import { InputError, withShoot, listKits } from "./input-repository";
import { objectStore } from "./object-store";
import { boundedBody, imageIntake, maxUploadBytes } from "./image-intake";
export const CONSENT_POLICY = "photo-intake-2026-11-07";
const now = () => new Date().toISOString();
function subject(state: InputState, id: string): Subject {
  const s = state.subjects.find((s) => s.id === id);
  if (!s)
    throw new InputError("NOT_FOUND", "Subject not found in this shoot.", 404);
  return s;
}
function consentIds(state: InputState, ids: string[]): Record<string, string> {
  return Object.fromEntries(
    ids.map((id) => {
      const s = subject(state, id);
      const c = s.consent;
      if (
        c?.status !== "GRANTED" ||
        c.policyVersion !== CONSENT_POLICY ||
        (requiresGuardian(s) && (!c.guardianName || !c.guardianRelationship))
      )
        throw new InputError(
          "CONSENT_REQUIRED",
          "Valid consent is required for every identifiable person before photo intake.",
          403,
        );
      return [id, c.id];
    }),
  );
}
function checkSnapshot(
  state: InputState,
  item: { subjectIds: string[]; consentIds: Record<string, string> },
) {
  const current = consentIds(state, item.subjectIds);
  if (item.subjectIds.some((id) => current[id] !== item.consentIds[id]))
    throw new InputError(
      "CONSENT_CHANGED",
      "Consent changed. Request a new upload permission.",
      403,
    );
}
function publicAsset(a: MediaAsset) {
  const { originalKey: _, derivativeKey: __, consentIds: ___, ...rest } = a;
  void _;
  void __;
  void ___;
  return rest;
}
async function flushDeletion(state: InputState) {
  const retained: string[] = [];
  for (const key of state.pendingDeletionKeys ?? []) {
    try {
      await objectStore().remove(key);
    } catch {
      retained.push(key);
    }
  }
  state.pendingDeletionKeys = retained;
}
async function discard(state: InputState, subjectId?: string) {
  const matches = (ids: string[]) => !subjectId || ids.includes(subjectId);
  for (const intent of state.intents)
    if (matches(intent.subjectIds)) intent.status = "INVALID";
  const removed = state.media.filter((a) => matches(a.subjectIds));
  state.media = state.media.filter((a) => !matches(a.subjectIds));
  state.referenceReviews = (state.referenceReviews ?? []).filter(
    (r) => !removed.some((a) => a.id === r.assetId),
  );
  state.pendingDeletionKeys = [
    ...new Set([
      ...(state.pendingDeletionKeys ?? []),
      ...removed.flatMap((a) => [a.originalKey, a.derivativeKey]),
    ]),
  ];
  await flushDeletion(state);
}
export const inputs = {
  async retryCleanup(owner: string, shootId: string) {
    return withShoot(owner, shootId, async (state) => {
      await flushDeletion(state);
      return { deletionPending: state.pendingDeletionKeys?.length ?? 0 };
    });
  },
  async read(owner: string, shootId: string) {
    return withShoot(owner, shootId, (state) => ({
      subjects: state.subjects,
      media: state.media
        .filter((a) =>
          state.intents.some(
            (i) => i.assetId === a.id && i.status === "COMPLETE",
          ),
        )
        .map(publicAsset),
      deletionPending: state.pendingDeletionKeys?.length ?? 0,
      cameraKit: state.cameraKit ?? null,
      policyVersion: CONSENT_POLICY,
    }));
  },
  async saveSubject(owner: string, shootId: string, raw: unknown, id?: string) {
    const data = subjectSchema.parse(raw);
    return withShoot(owner, shootId, async (state) => {
      if (!id && state.subjects.length >= 20)
        throw new InputError(
          "SUBJECT_LIMIT",
          "A shoot supports up to 20 profiles.",
        );
      const old = id ? subject(state, id) : undefined;
      // Any profile change invalidates permission: age and declared identity may have changed.
      if (old) await discard(state, id);
      const s: Subject = {
        ...data,
        id: old?.id ?? randomUUID(),
        consentHistory: old
          ? [
              ...old.consentHistory,
              ...(old.consent
                ? [
                    {
                      ...old.consent,
                      status: "REVOKED" as const,
                      recordedAt: now(),
                    },
                  ]
                : []),
            ]
          : [],
      };
      state.subjects = state.subjects.filter((s) => s.id !== id);
      state.subjects.push(s);
      return s;
    });
  },
  async removeSubject(owner: string, shootId: string, id: string) {
    return withShoot(owner, shootId, async (state) => {
      subject(state, id);
      await discard(state, id);
      state.subjects = state.subjects.filter((s) => s.id !== id);
      return { deleted: true };
    });
  },
  async consent(owner: string, shootId: string, id: string, raw: unknown) {
    const data = consentSchema.parse(raw);
    return withShoot(owner, shootId, async (state) => {
      const s = subject(state, id);
      if (
        data.status === "GRANTED" &&
        (!data.acknowledged || !data.confirmedAuthority)
      )
        throw new InputError(
          "ACKNOWLEDGEMENT_REQUIRED",
          "Confirm permission, purposes and the retention notice before granting consent.",
        );
      if (
        data.status === "GRANTED" &&
        requiresGuardian(s) &&
        (!data.guardianName || !data.guardianRelationship)
      )
        throw new InputError(
          "GUARDIAN_REQUIRED",
          "Guardian name and relationship are required for minors or unconfirmed ages.",
        );
      await discard(state, id);
      if (s.consent) s.consentHistory.push(s.consent);
      const c: Consent = {
        id: randomUUID(),
        actorUserId: owner,
        subjectId: id,
        status: data.status,
        policyVersion: CONSENT_POLICY,
        recordedAt: now(),
        guardianName: data.guardianName,
        guardianRelationship: data.guardianRelationship,
        allowAnalysis: data.status === "GRANTED" && data.allowAnalysis,
        allowGeneration: data.status === "GRANTED" && data.allowGeneration,
      };
      s.consent = c;
      return c;
    });
  },
  async intent(owner: string, shootId: string, raw: unknown) {
    const data = uploadIntentSchema.parse(raw);
    if (data.bytes > maxUploadBytes())
      throw new InputError(
        "UPLOAD_TOO_LARGE",
        "Image exceeds the upload limit.",
        413,
      );
    return withShoot(owner, shootId, async (state, workspace) => {
      if (workspace.workflowKind) {
        if (data.workflowScope && data.workflowScope !== workspace.workflowKind)
          throw new InputError(
            "WORKFLOW_SCOPE",
            "Attach references to the active workflow only.",
            409,
          );
        data.workflowScope = workspace.workflowKind;
      }
      const ids = consentIds(state, data.subjectIds);
      state.intents = state.intents.filter(
        (i) =>
          ["COMPLETE", "UPLOADED"].includes(i.status) ||
          (i.expiresAt > Date.now() && i.status !== "INVALID"),
      );
      if (
        state.intents.filter((i) => i.status === "PENDING").length >= 20 ||
        state.media.length >= 100
      )
        throw new InputError(
          "UPLOAD_LIMIT",
          "Remove unused photos or wait for upload permissions to expire.",
          429,
        );
      const intent: UploadIntent = {
        ...data,
        id: randomUUID(),
        expiresAt: Date.now() + 300000,
        consentIds: ids,
        status: "PENDING",
      };
      state.intents.push(intent);
      const token = await new SignJWT({ shootId, intentId: intent.id })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("framecraft")
        .setAudience("photo-upload")
        .setSubject(owner)
        .setExpirationTime(Math.floor(intent.expiresAt / 1000))
        .sign(authKey());
      return {
        id: intent.id,
        expiresAt: intent.expiresAt,
        uploadUrl: `/api/v1/shoots/${shootId}/uploads/${intent.id}`,
        uploadToken: token,
      };
    });
  },
  async upload(
    owner: string,
    shootId: string,
    intentId: string,
    request: Request,
  ) {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      throw new InputError(
        "INVALID_UPLOAD_TOKEN",
        "Upload permission is missing.",
        403,
      );
    let payload;
    try {
      payload = (
        await jwtVerify(token, authKey(), {
          algorithms: ["HS256"],
          issuer: "framecraft",
          audience: "photo-upload",
        })
      ).payload;
    } catch {
      throw new InputError(
        "INVALID_UPLOAD_TOKEN",
        "Upload permission expired or is invalid.",
        403,
      );
    }
    if (
      payload.sub !== owner ||
      payload.shootId !== shootId ||
      payload.intentId !== intentId
    )
      throw new InputError(
        "INVALID_UPLOAD_TOKEN",
        "Upload permission does not match this request.",
        403,
      );
    return withShoot(owner, shootId, async (state) => {
      const intent = state.intents.find((i) => i.id === intentId);
      if (
        !intent ||
        intent.status !== "PENDING" ||
        intent.expiresAt <= Date.now()
      )
        throw new InputError(
          "INVALID_UPLOAD",
          "Upload permission is expired or already used.",
          409,
        );
      checkSnapshot(state, intent);
      if (request.headers.get("content-type")?.split(";")[0] !== intent.mime)
        throw new InputError(
          "INVALID_IMAGE",
          "Content type must match upload permission.",
        );
      // Permission is checked BEFORE reading image bytes or invoking the decoder; lock spans intake.
      const bytes = await boundedBody(
        request,
        Math.min(intent.bytes, maxUploadBytes()),
      );
      if (bytes.length !== intent.bytes)
        throw new InputError(
          "SIZE_MISMATCH",
          "Upload size differs from the declared file size.",
        );
      const quality = await imageIntake.inspect(bytes, intent.mime);
      const assetId = randomUUID();
      const prefix = `shoots/${shootId}/inputs/${intent.kind === "SUBJECT_PHOTO" ? `subject-photos/${intent.subjectIds[0]}` : intent.kind.toLowerCase().replaceAll("_", "-")}/${assetId}`;
      const originalKey = prefix + ".original";
      const derivativeKey = prefix + ".webp";
      const storage = objectStore();
      try {
        await storage.put(originalKey, bytes, intent.mime);
        await storage.put(derivativeKey, quality.bytes, "image/webp");
      } catch {
        await Promise.allSettled([
          storage.remove(originalKey),
          storage.remove(derivativeKey),
        ]);
        throw new InputError(
          "STORAGE_FAILED",
          "Photo storage failed. Retry this upload.",
          503,
        );
      }
      state.media.push({
        id: assetId,
        kind: intent.kind,
        workflowScope: intent.workflowScope,
        referenceView: intent.referenceView,
        fileName: intent.fileName,
        mime: "image/webp",
        bytes: quality.bytes.length,
        width: quality.width,
        height: quality.height,
        sha256: createHash("sha256").update(quality.bytes).digest("hex"),
        subjectIds: intent.subjectIds,
        consentIds: intent.consentIds,
        originalKey,
        derivativeKey,
        warnings: quality.warnings,
        createdAt: now(),
      });
      intent.status = "UPLOADED";
      intent.assetId = assetId;
      return { intentId, status: "UPLOADED", warnings: quality.warnings };
    });
  },
  async complete(owner: string, shootId: string, intentId: string) {
    return withShoot(owner, shootId, async (state) => {
      const intent = state.intents.find((i) => i.id === intentId);
      if (!intent || !["UPLOADED", "COMPLETE"].includes(intent.status))
        throw new InputError(
          "UPLOAD_INCOMPLETE",
          "Upload and validate the image first.",
          409,
        );
      checkSnapshot(state, intent);
      const asset = state.media.find((a) => a.id === intent.assetId);
      if (!asset) throw new InputError("NOT_FOUND", "Photo not found.", 404);
      const storage = objectStore();
      const original = await storage.get(asset.originalKey);
      if (original.length !== intent.bytes)
        throw new InputError(
          "STORAGE_INTEGRITY",
          "Original image is incomplete. Delete it and upload again.",
          503,
        );
      const derivative = await storage.get(asset.derivativeKey);
      if (
        createHash("sha256").update(derivative).digest("hex") !== asset.sha256
      )
        throw new InputError(
          "STORAGE_INTEGRITY",
          "Download copy failed verification. Delete it and upload again.",
          503,
        );
      intent.status = "COMPLETE";
      return publicAsset(asset);
    });
  },
  async download(owner: string, shootId: string, assetId: string) {
    return withShoot(owner, shootId, async (state) => {
      const a = state.media.find((a) => a.id === assetId);
      if (!a) throw new InputError("NOT_FOUND", "Photo not found.", 404);
      checkSnapshot(state, a);
      const intent = state.intents.find(
        (i) => i.assetId === a.id && i.status === "COMPLETE",
      );
      if (!intent)
        throw new InputError(
          "UPLOAD_INCOMPLETE",
          "Complete this photo upload first.",
          409,
        );
      const bytes = await objectStore().get(a.derivativeKey);
      if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
        throw new InputError(
          "STORAGE_INTEGRITY",
          "Download copy failed verification.",
          503,
        );
      return {
        bytes,
        mime: "image/webp",
        name: `reference-${a.id}.webp`,
      };
    });
  },
  async removeMedia(owner: string, shootId: string, assetId: string) {
    return withShoot(owner, shootId, async (state) => {
      const a = state.media.find((a) => a.id === assetId);
      if (!a) throw new InputError("NOT_FOUND", "Photo not found.", 404);
      state.pendingDeletionKeys ??= [];
      state.pendingDeletionKeys.push(a.originalKey, a.derivativeKey);
      state.media = state.media.filter((a) => a.id !== assetId);
      for (const i of state.intents)
        if (i.assetId === assetId) i.status = "INVALID";
      const retained: string[] = [];
      for (const key of state.pendingDeletionKeys) {
        try {
          await objectStore().remove(key);
        } catch {
          retained.push(key);
        }
      }
      state.pendingDeletionKeys = retained;
      return { deleted: true, deletionPending: retained.length };
    });
  },
  async selectKit(owner: string, shootId: string, kitId: string | null) {
    const kit = kitId
      ? (await listKits(owner)).find((k) => k.id === kitId)
      : undefined;
    if (kitId && !kit)
      throw new InputError("NOT_FOUND", "Camera kit not found.", 404);
    return withShoot(owner, shootId, (state) => {
      if (kit) {
        const { id, ownerId, ...data } = kit;
        void ownerId;
        state.cameraKit = { ...data, sourceKitId: id };
      } else delete state.cameraKit;
      return state.cameraKit ?? null;
    });
  },
  async purge(owner: string, shootId: string) {
    return withShoot(
      owner,
      shootId,
      async (state) => {
        state.pendingDeletionKeys = [
          ...(state.pendingDeletionKeys ?? []),
          ...(state.artifacts ?? []).map((a) => a.storageKey),
        ];
        state.artifacts = [];
        await discard(state);
        state.subjects = [];
        state.intents = [];
        delete state.cameraKit;
        state.deleting = true;
        return !state.pendingDeletionKeys?.length;
      },
      true,
    );
  },
};
