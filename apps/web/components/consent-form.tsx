"use client";
import { useEffect, useState, useId } from "react";
import { requiresGuardian, type Subject } from "@framecraft/shared/inputs";
import { api } from "./client";
export function ConsentForm({
  shootId,
  subject,
  onChanged,
}: {
  shootId: string;
  subject: Subject;
  onChanged: () => void;
}) {
  const inputId = useId();
  const [guardianName, setName] = useState("");
  const [guardianRelationship, setRelation] = useState("");
  const [ack, setAck] = useState(false);
  const [authority, setAuthority] = useState(false);
  const [analysis, setAnalysis] = useState(
    subject.consent?.status === "GRANTED" && !!subject.consent.allowAnalysis,
  );
  const [generation, setGeneration] = useState(
    subject.consent?.status === "GRANTED" && !!subject.consent.allowGeneration,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guardian = requiresGuardian(subject);
  useEffect(() => {
    setAnalysis(
      subject.consent?.status === "GRANTED" && !!subject.consent.allowAnalysis,
    );
    setGeneration(
      subject.consent?.status === "GRANTED" &&
        !!subject.consent.allowGeneration,
    );
  }, [subject.consent?.id]);
  async function submit(status: "GRANTED" | "REFUSED" | "REVOKED") {
    setBusy(true);
    setError("");
    try {
      await api(`shoots/${shootId}/subjects/${subject.id}/consents`, "POST", {
        status,
        guardianName,
        guardianRelationship,
        acknowledged: ack,
        confirmedAuthority: authority,
        allowAnalysis: analysis,
        allowGeneration: generation,
      });
      onChanged();
      setAck(false);
      setAuthority(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        Photo consent ·{" "}
        {subject.consent?.status.toLowerCase() ?? "not recorded"}
      </summary>
      <div className="consent-notice">
        <p>
          Photo intake includes private storage, image quality checks, removal
          of metadata from download copies, and owner-only viewing/download.
          Photos are optional. Analysis runs only when requested after
          permission is granted. With OpenAI configured, a private
          metadata-stripped copy is sent to OpenAI; local mock mode does not
          inspect the image.
        </p>
        <p>
          Originals and download copies are kept until consent is
          refused/revoked or the photo, subject or shoot is deleted. Access is
          blocked on revocation; a storage outage can delay physical deletion
          and is shown as pending. Provider backups require a separate retention
          policy before launch.
        </p>
        <p>
          Recording a replacement permission removes photos linked to the
          previous permission. Record permission from every identifiable person
          in a group photo. Do not upload people who have not agreed.
        </p>
      </div>
      {guardian && (
        <>
          <p className="hint">
            A guardian is required for a minor or an unconfirmed age.
          </p>
          <div className="field">
            <label htmlFor={"guardian-" + inputId + subject.id}>
              Guardian name
            </label>
            <input
              id={"guardian-" + inputId + subject.id}
              maxLength={120}
              value={guardianName}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={"relationship-" + inputId + subject.id}>
              Guardian relationship
            </label>
            <input
              id={"relationship-" + inputId + subject.id}
              maxLength={120}
              value={guardianRelationship}
              onChange={(e) => setRelation(e.target.value)}
            />
          </div>
        </>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={authority}
          onChange={(e) => setAuthority(e.target.checked)}
        />{" "}
        I confirm that the subject, or their guardian, authorized me to record
        this permission.
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />{" "}
        The subject or guardian agreed to photo intake and the purposes and
        retention notice above.
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={analysis}
          onChange={(e) => setAnalysis(e.target.checked)}
        />{" "}
        Permit photo analysis for posing, lighting and wardrobe observations.
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={generation}
          onChange={(e) => setGeneration(e.target.checked)}
        />{" "}
        Permit image generation guided by approved reference observations.
        Generated people are fictional; original photos are not sent to the
        image generator.
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          disabled={
            busy ||
            !ack ||
            !authority ||
            (guardian && (!guardianName.trim() || !guardianRelationship.trim()))
          }
          onClick={() => void submit("GRANTED")}
        >
          Record consent
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void submit("REFUSED")}
        >
          Record refusal
        </button>
        <button
          className="danger"
          disabled={busy || subject.consent?.status !== "GRANTED"}
          onClick={() => void submit("REVOKED")}
        >
          Revoke consent & remove photos
        </button>
      </div>
      {subject.consent && (
        <p className="hint">
          Recorded {new Date(subject.consent.recordedAt).toLocaleString()} ·
          policy {subject.consent.policyVersion}
        </p>
      )}
    </details>
  );
}
