"use client";
import { useState } from "react";
import {
  mediaKinds,
  type Subject,
  type MediaAsset,
} from "@framecraft/shared/inputs";
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
}: {
  shootId: string;
  subjects: Subject[];
  media: PublicMedia[];
  onChanged: () => void;
}) {
  const [kind, setKind] =
    useState<(typeof mediaKinds)[number]>("SUBJECT_PHOTO");
  const [ids, setIds] = useState<string[]>([]);
  const [noPeople, setNoPeople] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<string>();
  const allowed =
    ids.every(
      (id) => subjects.find((s) => s.id === id)?.consent?.status === "GRANTED",
    ) &&
    (ids.length > 0 || (kind !== "SUBJECT_PHOTO" && noPeople));
  async function upload() {
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
        For photo-led styling and planning, enable photo-analysis permission in
        each person’s consent before uploading. Changing consent removes linked
        photos; you may need to upload them again.
      </p>
      <div className="field">
        <label htmlFor="photo-kind">Reference type</label>
        <select
          id="photo-kind"
          disabled={busy || !!complete}
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
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
        {kind !== "SUBJECT_PHOTO" && (
          <label className="check">
            <input
              type="checkbox"
              checked={noPeople}
              disabled={ids.length > 0}
              onChange={(e) => setNoPeople(e.target.checked)}
            />{" "}
            I confirm this reference contains no identifiable people.
          </label>
        )}
      </fieldset>
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
          Photo intake stays blocked until every declared person has valid
          consent, or a reference is confirmed to contain no identifiable
          people.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <button
        disabled={busy || (!complete && (!file || !allowed))}
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
