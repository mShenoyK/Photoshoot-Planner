"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShootNav } from "./shoot-nav";
import { ReferencePanel } from "./reference-panel";
import type { Shoot } from "@framecraft/shared";
import {
  type Subject,
  type InputState,
  requiresGuardian,
} from "@framecraft/shared/inputs";
import { api, human } from "./client";
import { SubjectForm } from "./subject-form";
import { ConsentForm } from "./consent-form";
import { PhotoIntake, type PublicMedia } from "./photo-intake";
import { EquipmentPanel } from "./equipment";
type Snapshot = {
  subjects: Subject[];
  media: PublicMedia[];
  cameraKit: InputState["cameraKit"] | null;
  deletionPending: number;
};
export function InputWorkspace({ shootId }: { shootId: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [shoot, setShoot] = useState<Shoot | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Subject | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try {
      const [input, brief] = await Promise.all([
        api<Snapshot>(`shoots/${shootId}/inputs`),
        api<Shoot>(`shoots/${shootId}`),
      ]);
      setData(input);
      setShoot(brief);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [shootId]);
  if (!data || !shoot)
    return (
      <section className="panel">
        {error ? (
          <p role="alert" className="error">
            {error} <button onClick={() => void load()}>Retry</button>
          </p>
        ) : (
          <p role="status">Loading people and private references…</p>
        )}
      </section>
    );
  return (
    <>
      <ShootNav shootId={shootId} />
      <Link href={"/shoots/" + shootId} className="hint">
        ← Shoot brief
      </Link>
      <div className="hero">
        <div>
          <p className="eyebrow">People, permission & preparation</p>
          <h1>{shoot.name}</h1>
          <p>
            Make room for every person’s preferences and comfort. Photos are
            always optional.
          </p>
        </div>
        <button onClick={() => setEditing("new")}>Add a person</button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data.deletionPending > 0 && (
        <p role="status" className="quality-note">
          Access to removed photos is blocked. {data.deletionPending} stored
          objects still need deletion. Retry cleanup after storage recovers.
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`shoots/${shootId}/media-cleanup`, "POST", {});
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry pending photo deletion
          </button>
        </p>
      )}
      <section className="banner">
        <div>
          <h3>
            {data.subjects.length} subject profiles ·{" "}
            {shoot.subjectCount ?? "Unspecified"} planned people
          </h3>
          <p>
            {shoot.subjectCount !== undefined &&
            shoot.subjectCount !== data.subjects.length
              ? "Profile count differs from the brief. Update the brief or add profiles before requesting exact group guidance."
              : "You can mix babies, children, adults and seniors in the same shoot."}
          </p>
        </div>
      </section>
      {editing && (
        <SubjectForm
          key={editing === "new" ? "new" : editing.id}
          shootId={shootId}
          existing={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {data.subjects.length ? (
        <section className="input-cards" aria-label="Subject profiles">
          {data.subjects.map((s) => (
            <article className="panel subject-card" key={s.id}>
              <span className="badge">
                {human(s.ageGroup)}
                {requiresGuardian(s) ? " · guardian required" : ""}
              </span>
              <h2>{s.label}</h2>
              <p className="hint">
                {s.ageYears !== undefined ? `${s.ageYears} years · ` : ""}
                {s.selfDescribedGender || "Gender not stated"}
              </p>
              <dl className="profile-summary">
                <dt>Style & comfort</dt>
                <dd>{s.fitComfort || s.stylePreferences || "Not specified"}</dd>
                <dt>Colors</dt>
                <dd>
                  {s.preferredColors || "Open to suggestions"}
                  {s.avoidedColors ? ` · avoid ${s.avoidedColors}` : ""}
                </dd>
                <dt>Access & mobility</dt>
                <dd>{s.mobilityNotes || "Not specified"}</dd>
              </dl>
              <div className="actions">
                <button className="secondary" onClick={() => setEditing(s)}>
                  Edit {s.label}
                </button>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={async () => {
                    if (
                      !confirm(
                        "Delete this profile and all photos linked to it?",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await api(`shoots/${shootId}/subjects/${s.id}`, "DELETE");
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete {s.label}
                </button>
              </div>
              <ConsentForm
                shootId={shootId}
                subject={s}
                onChanged={() => void load()}
              />
            </article>
          ))}
        </section>
      ) : (
        <section className="panel empty">
          <h2>Every person has a place.</h2>
          <p>
            Add a mixed-age family or an individual subject. You can leave
            optional details blank and use no photographs.
          </p>
          <button onClick={() => setEditing("new")}>
            Add your first subject
          </button>
        </section>
      )}
      <div className="workspace-stack">
        <PhotoIntake
          shootId={shootId}
          subjects={data.subjects}
          media={data.media}
          onChanged={() => void load()}
        />
        <ReferencePanel
          shootId={shootId}
          refreshKey={data.media.map((m) => m.id).join(",")}
        />
        <section className="banner">
          <div>
            <h3>Selected equipment</h3>
            <p>
              {data.cameraKit
                ? `${data.cameraKit.body} · ${data.cameraKit.lens} · ${data.cameraKit.flashCount} flashes · ${data.cameraKit.modifiers}`
                : "No camera kit selected. Add a preset or record your own equipment below."}
            </p>
          </div>
        </section>
        <EquipmentPanel shootId={shootId} onSelected={() => void load()} />
      </div>
    </>
  );
}
