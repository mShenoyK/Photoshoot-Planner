"use client";
import { useEffect, useState } from "react";
import type { Subject, ReferenceScope } from "@framecraft/shared/inputs";
import { PhotoIntake, type PublicMedia } from "./photo-intake";
import { SubjectForm } from "./subject-form";
import { ConsentForm } from "./consent-form";
import { api } from "./client";
export function WorkflowIntake({
  shootId,
  scope,
  onChanged,
}: {
  shootId: string;
  scope: ReferenceScope;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{
    subjects: Subject[];
    media: PublicMedia[];
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      setData(await api(`shoots/${shootId}/inputs`));
      setError("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [shootId, scope]);
  return (
    <div>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => void load()}>Retry intake</button>
        </p>
      )}
      {!data ? (
        <p role="status">Loading workflow intake…</p>
      ) : (
        <>
          <p>
            Declare every identifiable person and record consent before
            uploading. Analysis needs its own permission; guardian consent is
            required for minors.
          </p>
          <button className="secondary" onClick={() => setAdding(true)}>
            Add reference person
          </button>
          {adding && (
            <SubjectForm
              shootId={shootId}
              onSaved={() => {
                setAdding(false);
                void load();
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {data.subjects.map((subject) => (
            <details key={subject.id}>
              <summary>Consent for {subject.label}</summary>
              <ConsentForm
                shootId={shootId}
                subject={subject}
                onChanged={() => void load()}
              />
            </details>
          ))}
          <PhotoIntake
            shootId={shootId}
            scope={scope}
            subjects={data.subjects}
            media={data.media.filter((m) => m.workflowScope === scope)}
            onChanged={() => void load()}
          />
        </>
      )}
    </div>
  );
}
