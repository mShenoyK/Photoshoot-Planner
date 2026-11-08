"use client";
import { GeneratedVisual } from "./generated-visual";
import { useEffect, useState } from "react";
import { ShootNav } from "./shoot-nav";
import { ReferencePanel } from "./reference-panel";
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
  sourcesAvailable?: boolean;
  subjects: { id: string; label: string }[];
};
export function StylingStudio({
  shootId,
  mode,
  standalone = false,
}: {
  shootId: string;
  standalone?: boolean;
  mode: "lighting" | "wardrobe";
}) {
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<"CONTEXT" | "STACKED_MONOCHROME">(
    "CONTEXT",
  );
  const [fill, setFill] = useState(false);
  const [autoRevision, setAutoRevision] = useState<number | null>(null);
  const [knowledgeOnly, setKnowledgeOnly] = useState(false);
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

          setKnowledgeOnly(v.latest?.wardrobe?.knowledgeOnly ?? false);
          setHero(v.latest?.wardrobe?.heroSubjectId ?? "");
          if (v.latest?.lighting) {
            setRecipe(v.latest.lighting.recipe);
            setFill(
              v.latest.lighting.scene.lights.some((l) => l.purpose === "FILL"),
            );
          }
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
      if (["LIGHTING", "WARDROBE", "SCENE"].includes(String(action.action)))
        setAutoRevision(v.latest?.revision ?? null);
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
    <section className="container">
      {!standalone && <ShootNav shootId={shootId} />}
      <h1>{mode === "lighting" ? "Lighting Lab" : "Wardrobe Stylist"}</h1>
      <p>
        {mode === "lighting"
          ? "Original schematics and unmetered starting settings. Verify on location."
          : "Three considered looks per person. Review your photo’s visible proportions and colors, or start with personal preferences. You make the final choice."}
      </p>
      <p className="hint">
        New recommendations request original images when OpenAI image generation
        is configured. Images are reviewed before publication; provider usage
        applies. Technical SVG lighting diagrams remain exact editable layouts.
      </p>
      {mode === "wardrobe" && (
        <section className="panel">
          <h2>From the knowledge library — no image needed</h2>
          <p>
            Use reviewed wardrobe and composition principles from the supplied
            portrait books with your stated preferences. No skin or body
            assumptions are made. Attached image observations and photo-derived
            outfit locks are excluded in this mode.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={knowledgeOnly}
              onChange={(e) => setKnowledgeOnly(e.target.checked)}
            />
            Use knowledge only, without reference images
          </label>
        </section>
      )}
      {!(mode === "wardrobe" && knowledgeOnly) && (
        <ReferencePanel
          scope={mode === "lighting" ? "LIGHTING" : "WARDROBE"}
          shootId={shootId}
          onApproved={() => {
            api<View>(`shoots/${shootId}/styling`)
              .then(setData)
              .catch((e) => setError(e.message));
          }}
        />
      )}
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
          {standalone && current && (
            <p>
              <a
                className="button secondary"
                href={`/api/v1/shoots/${shootId}/styling/export.json`}
                download
              >
                Download current styling JSON
              </a>
            </p>
          )}
          {data.sourcesAvailable === false && (
            <p role="alert">
              A knowledge source is unavailable. Regenerate before sharing these
              recommendations.
            </p>
          )}
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
                {lighting && (
                  <GeneratedVisual
                    key={`lighting:${current!.revision}`}
                    shootId={shootId}
                    target={{
                      kind: "LIGHTING",
                      stylingRevision: current!.revision,
                    }}
                    autoGenerate={autoRevision === current!.revision}
                  />
                )}
                {!lighting && (
                  <p>
                    No lighting saved. Choose a recipe to create original top
                    and side diagrams.
                  </p>
                )}
                {lighting && (
                  <>
                    <h2>{lighting.title}</h2>
                    <fieldset key={current?.revision}>
                      <legend>Adjust your setup</legend>
                      <div className="row">
                        {(
                          [
                            ["camera", "heightM", "Camera height (m)"],
                            ["key", "x", "Key horizontal position (m)"],
                            ["key", "y", "Key depth position (m)"],
                            ["key", "heightM", "Key height (m)"],
                          ] as const
                        ).map(([target, field, label]) => (
                          <label key={label}>
                            {label}
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max={field === "heightM" ? 4 : 12}
                              defaultValue={
                                target === "camera"
                                  ? lighting.scene.camera[field]
                                  : lighting.scene.lights[0][field]
                              }
                              onChange={(e) => {
                                try {
                                  const scene = dirty
                                    ? JSON.parse(sceneText)
                                    : structuredClone(lighting.scene);
                                  if (target === "camera")
                                    scene.camera[field] = Number(
                                      e.target.value,
                                    );
                                  else
                                    scene.lights[0][field] = Number(
                                      e.target.value,
                                    );
                                  setSceneText(JSON.stringify(scene, null, 2));
                                  setDirty(true);
                                } catch {
                                  setError(
                                    "Correct or discard the JSON edits before adjusting the setup.",
                                  );
                                }
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        disabled={!dirty}
                        onClick={() => {
                          try {
                            void act({
                              action: "SCENE",
                              scene: JSON.parse(sceneText),
                            });
                          } catch {
                            setError("Check your setup values.");
                          }
                        }}
                      >
                        Update lighting diagram
                      </button>
                      <p className="hint">
                        Save to redraw both views. Positions and heights are
                        starting assumptions, not measurements inferred from
                        your photo.
                      </p>
                    </fieldset>
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
                      knowledgeOnly,
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
                    {wardrobe.provider && (
                      <p className="hint">
                        Wardrobe advice: {wardrobe.provider}
                      </p>
                    )}
                    {wardrobe.knowledgeOnly && (
                      <p className="quality-note">
                        Knowledge-only output: no photo observations used.
                      </p>
                    )}
                    {!!wardrobe.sourceNotes?.length && (
                      <details>
                        <summary>
                          Knowledge sources ({wardrobe.sourceNotes.length})
                        </summary>
                        {wardrobe.sourceNotes.map((note) => (
                          <p className="hint" key={note.reference.chunkId}>
                            {note.summary} · {note.reference.documentTitle} ·
                            PDF page {note.reference.pageStart} · review{" "}
                            {note.reference.chunkRevision}
                          </p>
                        ))}
                      </details>
                    )}
                    <div
                      className="palette-strip"
                      aria-label="Coordinated wardrobe colors"
                    >
                      {wardrobe.palette.map((c) => (
                        <span key={c}>
                          <span
                            className="palette-dot"
                            style={{
                              backgroundColor: /^#[0-9a-f]{6}$/i.test(c)
                                ? c
                                : ((
                                    {
                                      cream: "#e8deca",
                                      navy: "#26374a",
                                      terracotta: "#aa6f51",
                                      slate: "#63717d",
                                      "muted blue": "#809cb3",
                                    } as Record<string, string>
                                  )[c] ?? "#c1c5cb"),
                            }}
                          />
                          {c}
                        </span>
                      ))}
                    </div>
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
                              <GeneratedVisual
                                key={`${current!.revision}:${look.subjectId}:${c.id}`}
                                shootId={shootId}
                                target={{
                                  kind: "WARDROBE",
                                  stylingRevision: current!.revision,
                                  subjectId: look.subjectId,
                                  candidateId: c.id,
                                }}
                                autoGenerate={
                                  autoRevision === current!.revision
                                }
                              />
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
    </section>
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
