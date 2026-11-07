"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  Styling,
  StylingAction,
  Wardrobe,
} from "@framecraft/shared/styling";
import { renderLightingSvg } from "@framecraft/shared/lighting-svg";
import { api } from "./client";
type View = {
  latest: Styling | null;
  versions: Styling[];
  stale: boolean;
  subjects: { id: string; label: string }[];
};
export function StylingStudio({
  shootId,
  mode,
}: {
  shootId: string;
  mode: "lighting" | "wardrobe";
}) {
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<"CONTEXT" | "STACKED_MONOCHROME">(
    "CONTEXT",
  );
  const [fill, setFill] = useState(false);
  const [hero, setHero] = useState("");
  const [sceneText, setSceneText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    api<View>(`shoots/${shootId}/styling`)
      .then((v) => {
        if (active) {
          setData(v);
          setHero(v.latest?.wardrobe?.heroSubjectId ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [shootId]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty || notesDirty) e.preventDefault();
    };
    const navigate = (e: MouseEvent) => {
      if (
        (dirty || notesDirty) &&
        (e.target as Element).closest("a") &&
        !confirm("Discard unsaved edits?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, notesDirty]);
  const current =
    version === null
      ? data?.latest
      : data?.versions.find((v) => v.revision === version);
  const history = version !== null && version !== data?.latest?.revision;
  const lighting = current?.lighting;
  const wardrobe = current?.wardrobe;
  const act = async (
    action: Omit<StylingAction, "baseRevision"> | Record<string, unknown>,
  ) => {
    if (
      (dirty || notesDirty) &&
      action.action !== "SCENE" &&
      action.action !== "OBSERVATION" &&
      !confirm("Discard unsaved edits?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      const v = await api<View>(`shoots/${shootId}/styling`, "POST", {
        ...action,
        baseRevision: data?.latest?.revision ?? 0,
      });
      setData(v);
      setVersion(null);
      setDirty(false);
      setNotesDirty(false);
      setSceneText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save. Retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="container">
      <nav className="actions" aria-label="Shoot tools">
        <Link href={`/shoots/${shootId}`}>Shoot brief</Link>
        <Link href={`/shoots/${shootId}/subjects`}>People & equipment</Link>
        <Link href={`/shoots/${shootId}/plan`}>Plan</Link>
        <Link href={`/shoots/${shootId}/lighting`}>Lighting Lab</Link>
        <Link href={`/shoots/${shootId}/wardrobe`}>Wardrobe Stylist</Link>
      </nav>
      <h1>{mode === "lighting" ? "Lighting Lab" : "Wardrobe Stylist"}</h1>
      <p>
        {mode === "lighting"
          ? "Original schematics and unmetered starting settings. Verify on location."
          : "Three original looks per person, using manual preferences. Photos are optional; no photo analysis or personality inference."}
      </p>
      {error && (
        <div role="alert">
          {error}{" "}
          <button onClick={() => window.location.reload()}>
            Reload saved work
          </button>
        </div>
      )}
      {!data && !error && <p role="status">Loading private workspace…</p>}
      {data && (
        <>
          {data.stale && (
            <p role="status">
              Inputs changed. Regenerate affected sections; old versions retain
              their original assumptions. Unlock any outdated outfits before
              rebalancing.
            </p>
          )}
          <label>
            Styling version
            <select
              value={version ?? data.latest?.revision ?? ""}
              onChange={(e) => {
                if ((dirty || notesDirty) && !confirm("Discard unsaved edits?"))
                  return;
                setVersion(Number(e.target.value));
                setNotesDirty(false);
                setDirty(false);
                setSceneText("");
              }}
            >
              {!data.versions.length && (
                <option value="">No saved version</option>
              )}
              {data.versions.map((v) => (
                <option key={v.revision} value={v.revision}>
                  Version {v.revision} ·{" "}
                  {new Date(v.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {history && (
            <p>
              Historical version — read only. Select the latest version to edit.
            </p>
          )}
          <fieldset disabled={busy || history}>
            {mode === "lighting" ? (
              <>
                <label>
                  Lighting recipe
                  <select
                    value={recipe}
                    onChange={(e) => setRecipe(e.target.value as typeof recipe)}
                  >
                    <option value="CONTEXT">
                      Match shoot environment and light
                    </option>
                    <option value="STACKED_MONOCHROME">
                      Stacked monochrome family
                    </option>
                  </select>
                </label>
                <label className="styling-check">
                  <input
                    type="checkbox"
                    checked={fill}
                    onChange={(e) => setFill(e.target.checked)}
                  />
                  Optional weak second-flash fill, if available
                </label>
                <button
                  onClick={() => act({ action: "LIGHTING", recipe, fill })}
                >
                  {lighting ? "Regenerate lighting" : "Generate lighting"}
                </button>
                {!lighting && (
                  <p>
                    No lighting saved. Choose a recipe to create original top
                    and side diagrams.
                  </p>
                )}
                {lighting && (
                  <>
                    <h2>{lighting.title}</h2>
                    <div className="styling-diagrams">
                      {(["top", "side"] as const).map((view) => (
                        <figure key={view}>
                          <div
                            dangerouslySetInnerHTML={{
                              __html: renderLightingSvg(lighting.scene, view),
                            }}
                          />
                          <figcaption>
                            {view === "top"
                              ? "Top view"
                              : "Side elevation; depth omitted"}
                          </figcaption>
                          {!history && (
                            <a
                              href={`/api/v1/shoots/${shootId}/styling/${view}.svg`}
                              download
                            >
                              Download {view} SVG
                            </a>
                          )}
                        </figure>
                      ))}
                    </div>
                    <dl>
                      {Object.entries(lighting.settings).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <ul>
                      {lighting.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                    <p>{lighting.provenance}</p>
                    <details>
                      <summary>Edit diagram coordinates</summary>
                      <p>
                        Positions are meters within the bounds; height controls
                        side elevation. Directions use degrees clockwise from
                        right. Save creates a new version.
                      </p>
                      <label>
                        Scene coordinates (JSON)
                        <textarea
                          rows={14}
                          value={
                            dirty
                              ? sceneText
                              : JSON.stringify(lighting.scene, null, 2)
                          }
                          onChange={(e) => {
                            setSceneText(e.target.value);
                            setDirty(true);
                          }}
                        />
                      </label>
                      <button
                        disabled={!dirty}
                        onClick={() => {
                          try {
                            const scene: unknown = JSON.parse(sceneText);
                            void act({ action: "SCENE", scene });
                          } catch {
                            setError("Enter valid scene JSON.");
                          }
                        }}
                      >
                        Save diagram
                      </button>
                      <button
                        onClick={() => {
                          setDirty(false);
                          setSceneText("");
                        }}
                      >
                        Discard diagram edits
                      </button>
                    </details>
                  </>
                )}
              </>
            ) : (
              <>
                <label>
                  Hero outfit anchor
                  <select
                    value={hero}
                    onChange={(e) => setHero(e.target.value)}
                  >
                    <option value="">No hero</option>
                    {data.subjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label || "Subject"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() =>
                    act({
                      action: "WARDROBE",
                      ...(hero ? { heroSubjectId: hero } : {}),
                    })
                  }
                >
                  {wardrobe ? "Rebalance unlocked looks" : "Generate wardrobe"}
                </button>
                {!wardrobe && (
                  <p>
                    Add manual subject profiles, then generate. No photos are
                    required.
                  </p>
                )}
                {wardrobe && (
                  <>
                    <h2>Coordinated palette</h2>
                    <p>{wardrobe.palette.join(" · ")}</p>
                    <p>{wardrobe.rationale}</p>
                    {wardrobe.looks.map((look) => (
                      <section
                        className="panel"
                        key={look.subjectId}
                        aria-label={`Looks for ${look.label}`}
                      >
                        <h2>{look.label}</h2>
                        <p>
                          {look.locked ? "Outfit locked" : "Outfit unlocked"}
                        </p>
                        <button
                          onClick={() =>
                            act({
                              action: "SELECT",
                              subjectId: look.subjectId,
                              candidateId: look.selectedId,
                              locked: !look.locked,
                            })
                          }
                        >
                          {look.locked ? "Unlock" : "Lock"} {look.label}
                        </button>
                        <div className="outfit-grid">
                          {look.candidates.map((c) => (
                            <article className="card" key={c.id}>
                              <h3>{c.name}</h3>
                              <p>
                                {c.color} ·{" "}
                                {look.selectedId === c.id
                                  ? "Selected"
                                  : "Alternative"}
                              </p>
                              <ul>
                                {c.garments.map((g) => (
                                  <li key={g}>{g}</li>
                                ))}
                              </ul>
                              <p>{c.rationale}</p>
                              <p>{c.suitability}</p>
                              <p>{c.comfort}</p>
                              <p>{c.alternatives}</p>
                              <ul>
                                {c.accessories.map((a) => (
                                  <li key={a}>{a}</li>
                                ))}
                              </ul>
                              <button
                                disabled={
                                  look.locked || look.selectedId === c.id
                                }
                                onClick={() =>
                                  act({
                                    action: "SELECT",
                                    subjectId: look.subjectId,
                                    candidateId: c.id,
                                    locked: false,
                                  })
                                }
                              >
                                Choose {c.name} for {look.label}
                              </button>
                            </article>
                          ))}
                        </div>
                        <ObservationEditor
                          key={look.subjectId}
                          revision={current?.revision ?? 0}
                          subjectId={look.subjectId}
                          initial={wardrobe.observations.find(
                            (o) => o.subjectId === look.subjectId,
                          )}
                          onDirty={() => setNotesDirty(true)}
                          onSave={(observation) =>
                            act({ action: "OBSERVATION", observation })
                          }
                        />
                      </section>
                    ))}
                    <p>{wardrobe.provenance}</p>
                  </>
                )}
              </>
            )}
          </fieldset>
          {busy && <p role="status">Saving a new version…</p>}
        </>
      )}
    </main>
  );
}
function ObservationEditor({
  revision,
  subjectId,
  initial,
  onSave,
  onDirty,
}: {
  revision: number;
  onDirty: () => void;
  subjectId: string;
  initial?: Wardrobe["observations"][number];
  onSave: (o: Wardrobe["observations"][number]) => Promise<void>;
}) {
  const [o, setO] = useState(
    initial ?? {
      subjectId,
      visibleColors: "",
      fabricNotes: "",
      fitNotes: "",
      uncertainty:
        "User-reported; confirm under neutral light. No photo analysis performed.",
      source: "USER_REPORTED" as const,
    },
  );
  useEffect(() => {
    setO(
      initial ?? {
        subjectId,
        visibleColors: "",
        fabricNotes: "",
        fitNotes: "",
        uncertainty:
          "User-reported; confirm under neutral light. No photo analysis performed.",
        source: "USER_REPORTED",
      },
    );
  }, [initial, subjectId, revision]);
  return (
    <details>
      <summary>Editable observations and comfort notes</summary>
      <p>
        Record only voluntarily reported garment colors, fabric and fit.
        Lighting casts, blur, occlusion and perspective can make visual
        observations unreliable. These notes are not measurements or personality
        assessments. Save before rebalancing.
      </p>
      {(
        [
          ["visibleColors", "Reported visible garment colors"],
          ["fabricNotes", "Fabric and texture notes"],
          ["fitNotes", "Fit and comfort notes"],
          ["uncertainty", "Uncertainty and lighting caveats"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <textarea
            maxLength={1000}
            value={o[key]}
            onChange={(e) => {
              setO({ ...o, [key]: e.target.value });
              onDirty();
            }}
          />
        </label>
      ))}
      <button onClick={() => onSave(o)}>Save observations</button>
    </details>
  );
}
