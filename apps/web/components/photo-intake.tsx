"use client";
import { useEffect, useState } from "react";
import {
  mediaKinds,
  requiresGuardian,
  referenceViews,
  type ReferenceScope,
  type Subject,
  type MediaAsset,
} from "@framecraft/shared/inputs";
import { ConsentForm } from "./consent-form";
import { api, human } from "./client";
export type PublicMedia = Omit<
  MediaAsset,
  "originalKey" | "derivativeKey" | "consentIds"
>;
export function PhotoIntake({
  shootId,
  subjects,
  media,
  onChanged,
  scope,
}: {
  shootId: string;
  subjects: Subject[];
  media: PublicMedia[];
  onChanged: () => void;
  scope?: ReferenceScope;
}) {
  const [kind, setKind] =
    useState<(typeof mediaKinds)[number]>("SUBJECT_PHOTO");
  const [view, setView] = useState<(typeof referenceViews)[number]>("FRONT");
  const [ids, setIds] = useState<string[]>([]);
  const [noPeople, setNoPeople] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<string>();
  useEffect(() => {
    setIds((current) =>
      current.filter((id) => subjects.some((s) => s.id === id)),
    );
  }, [subjects]);
  const allowed =
    ids.every(
      (id) => subjects.find((s) => s.id === id)?.consent?.status === "GRANTED",
    ) &&
    (ids.length > 0 || (kind !== "SUBJECT_PHOTO" && noPeople));
  const blockers =
    !ids.length && !noPeople
      ? [
          "Select every identifiable person below, or confirm that the reference contains no identifiable people.",
        ]
      : ids.flatMap((id) => {
          const subject = subjects.find((s) => s.id === id);
          return !subject || subject.consent?.status !== "GRANTED"
            ? [
                `Record photo consent for ${subject?.label || "the selected person"}${subject && requiresGuardian(subject) ? " with their guardian" : ""}.`,
              ]
            : [];
        });
  async function upload() {
    if (!complete && !allowed) {
      setError(
        blockers.join(" ") ||
          "Review the people and consent declarations before upload.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      let id = complete;
      if (!id) {
        if (!file) throw new Error("Choose a JPG, PNG or WebP image.");
        setStatus("Checking permission…");
        const intent = await api<{
          id: string;
          uploadUrl: string;
          uploadToken: string;
        }>(`shoots/${shootId}/upload-intents`, "POST", {
          fileName: file.name,
          mime: file.type,
          bytes: file.size,
          kind,
          workflowScope: scope,
          referenceView: view,
          subjectIds: ids,
          noIdentifiablePeople: noPeople && !ids.length,
        });
        setStatus("Checking image quality and saving privately…");
        const r = await fetch(intent.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            Authorization: `Bearer ${intent.uploadToken}`,
          },
          body: file,
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error?.message ?? "Upload failed.");
        id = intent.id;
        setComplete(id);
      }
      setStatus("Completing upload…");
      await api(`shoots/${shootId}/uploads/${id}/complete`, "POST", {});
      setComplete(undefined);
      setStatus("Photo saved privately.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setStatus("Photo intake did not complete. Retry is available.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" id="photo-intake">
      <p className="eyebrow">Optional references</p>
      <h2>Private photo intake</h2>
      <p className="muted">
        Use neutral lighting, minimal filtering and a full-length view when
        practical. Check focus and perspective yourself; automated checks cannot
        reliably judge blur, occlusion or color casts.
      </p>
      <p className="quality-note">
        For photo-led recommendations, enable photo analysis before uploading.
        To guide generated images with those observations, also enable
        image-generation permission for every person. Changing consent replaces
        the previous permission and removes linked photos; record the intended
        purposes first.
      </p>
      {scope && (
        <p className="quality-note">
          These images belong only to {human(scope)}. They are not automatically
          shared with other tools.
        </p>
      )}
      {scope === "WARDROBE" && (
        <p>
          Optional views: front in neutral light for visible color; side for
          garment drape; head-to-toe for outfit proportions and shoes; detail
          for fabric; inspiration for your preferred style. Upload only views
          you are comfortable sharing, in normal clothing. Skin-color
          impressions and body proportions are uncertain, editable observations,
          never ethnicity, health or measurements. No photos are required in
          knowledge-only mode.
        </p>
      )}
      <div className="field">
        <label htmlFor="reference-view">Reference view</label>
        <select
          id="reference-view"
          value={view}
          disabled={busy || !!complete}
          onChange={(e) => setView(e.target.value as typeof view)}
        >
          {referenceViews.map((v) => (
            <option key={v} value={v}>
              {human(v)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="photo-kind">Reference type</label>
        <select
          id="photo-kind"
          disabled={busy || !!complete}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            if (e.target.value === "SUBJECT_PHOTO") setNoPeople(false);
          }}
        >
          {mediaKinds.map((v) => (
            <option key={v} value={v}>
              {human(v)}
            </option>
          ))}
        </select>
      </div>
      <fieldset disabled={busy || !!complete}>
        <legend>Every identifiable person in this image</legend>
        {subjects.length ? (
          subjects.map((s) => (
            <label className="check" key={s.id}>
              <input
                type="checkbox"
                checked={ids.includes(s.id)}
                onChange={(e) => {
                  setIds(
                    e.target.checked
                      ? [...ids, s.id]
                      : ids.filter((id) => id !== s.id),
                  );
                  setNoPeople(false);
                }}
              />
              {s.label} · consent{" "}
              {s.consent?.status.toLowerCase() ?? "not recorded"}
            </label>
          ))
        ) : (
          <p className="hint">
            Add subject profiles and record consent before uploading people.
          </p>
        )}
        {
          <label className="check">
            <input
              type="checkbox"
              checked={noPeople}
              disabled={ids.length > 0}
              onChange={(e) => {
                setNoPeople(e.target.checked);
                if (e.target.checked && kind === "SUBJECT_PHOTO")
                  setKind(
                    scope === "LIGHTING"
                      ? "SCENE_REFERENCE"
                      : scope === "WARDROBE"
                        ? "WARDROBE_REFERENCE"
                        : "POSE_REFERENCE",
                  );
              }}
            />{" "}
            I confirm this reference contains no identifiable people.
          </label>
        }
      </fieldset>
      {ids
        .map((id) => subjects.find((s) => s.id === id))
        .filter((s): s is Subject => !!s)
        .map((subject) => (
          <div className="intake-permission" key={subject.id}>
            <h3>Permission for {subject.label}</h3>
            <ConsentForm
              shootId={shootId}
              subject={subject}
              onChanged={onChanged}
            />
          </div>
        ))}
      <div className="field">
        <label htmlFor="photo-file">
          Choose image (JPG, PNG or WebP; default limit 15 MB)
        </label>
        <input
          id="photo-file"
          disabled={busy || !!complete}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
          }}
        />
      </div>
      {!allowed && (
        <p className="hint">
          {blockers.join(" ")} Select a file, then choose Upload privately to
          review any missing steps. No image is processed until permission is
          valid.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <button
        disabled={busy || (!complete && !file)}
        onClick={() => void upload()}
      >
        {busy ? "Working…" : complete ? "Retry completion" : "Upload privately"}
      </button>
      <h3 style={{ marginTop: 30 }}>Saved references</h3>
      {!media.length ? (
        <p className="hint">
          No photos yet. Manual profiles are enough to continue planning.
        </p>
      ) : (
        media.map((a) => (
          <article className="media-row" key={a.id}>
            <h3>{a.fileName}</h3>
            <p className="hint">
              {human(a.kind)} · {a.width} × {a.height} · Download copy has
              metadata removed.
            </p>
            {a.warnings.map((w) => (
              <p key={w} className="quality-note">
                {w}
              </p>
            ))}
            <div className="actions">
              <a
                className="button secondary"
                href={`/api/v1/shoots/${shootId}/media/${a.id}/download`}
                download
              >
                Download private copy
              </a>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Delete this photo and its private original?"))
                    return;
                  setBusy(true);
                  try {
                    await api(`shoots/${shootId}/media/${a.id}`, "DELETE");
                    onChanged();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete photo
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
