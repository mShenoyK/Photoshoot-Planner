"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CompletePlanPanel } from "./complete-plan-panel";
import { PoseSchematic } from "./pose-schematic";
import { ShootNav } from "./shoot-nav";
import { ReferencePanel } from "./reference-panel";
import type { ShootPlan } from "@framecraft/shared/planning";
import type { TaskJob } from "@framecraft/shared/knowledge";
import { api, human } from "./client";
type Plan = ShootPlan & { citationStatus: "VALID" | "SOURCE_UNAVAILABLE" };
export function PlanStudio({
  shootId,
  poseStudio = false,
  standalone = false,
}: {
  shootId: string;
  poseStudio?: boolean;
  standalone?: boolean;
}) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [job, setJob] = useState<TaskJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [useKnowledge, setKnowledge] = useState(true);
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const load = async () => {
    const data = await api<Plan[]>(`shoots/${shootId}/plans`);
    setPlans(data);
    setRefresh((v) => v + 1);
    setDraft(data.at(-1) ?? null);
    setDirty(new Set());
  };
  async function receiveJob(next: TaskJob) {
    if (next.status === "SUCCEEDED") await load();
    setJob(next);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [shootId]);
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      api<TaskJob>("jobs/" + job.id)
        .then(async (next) => {
          if (!active) return;
          if (next.status === "SUCCEEDED") await load();
          setJob(next);
          if (next.status === "FAILED")
            setError(
              `Generation failed: ${next.errorCode}. Your saved versions are retained.`,
            );
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 600);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.size) e.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirty.size ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (anchor?.getAttribute("href")?.startsWith("#")) return;
      if (anchor && !confirm("Leave this plan without saving your edits?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", navigate, true);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  const latest = draft?.id === plans?.at(-1)?.id;
  const jobActive = !!job && ["QUEUED", "RUNNING"].includes(job.status);
  const locked = (section: "creativeBrief" | "poses" | "shotList") =>
    !latest || busy || jobActive || draft?.lockedSections.includes(section);
  function mark(key: string) {
    setDirty(new Set([...dirty, key]));
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function controls(section: "creativeBrief" | "poses" | "shotList") {
    if (!draft) return null;
    return (
      <SectionControls
        section={section}
        plan={draft}
        disabled={busy || !latest || !!dirty.size || jobActive}
        onLock={async (value) => {
          await action(async () => {
            await api(`shoots/${shootId}/plans/${draft.id}`, "PATCH", {
              baseVersion: draft.version,
              lockedSections: draft.lockedSections.includes(value)
                ? draft.lockedSections.filter((s) => s !== value)
                : [...draft.lockedSections, value],
            });
            await load();
          });
        }}
        onRegenerate={async (value) => {
          await action(
            async () =>
              await receiveJob(
                await api<TaskJob>(
                  `shoots/${shootId}/plans/${draft.id}/regenerate-section`,
                  "POST",
                  {
                    baseVersion: draft.version,
                    section: value,
                    idempotencyKey: crypto.randomUUID(),
                  },
                ),
              ),
          );
        }}
      />
    );
  }
  async function generate(complete = false, knowledgeOnly = false) {
    await action(async () => {
      await receiveJob(
        await api<TaskJob>(
          `shoots/${shootId}/${complete ? "complete-plan" : "plans"}`,
          "POST",
          {
            poseCount: 6,
            useKnowledgeBase: knowledgeOnly || useKnowledge,
            knowledgeOnly,
            referenceScope: poseStudio ? "POSES" : "PLAN",
            idempotencyKey: crypto.randomUUID(),
          },
        ),
      );
    });
  }
  return (
    <>
      {!standalone && (
        <Link className="hint" href={"/shoots/" + shootId}>
          ← Shoot brief
        </Link>
      )}
      {!standalone && <ShootNav shootId={shootId} />}
      <div className="hero">
        <div>
          <p className="eyebrow">Creative direction, with a record</p>
          <h1>{poseStudio ? "Pose Studio." : "A plan you can shape."}</h1>
          <p>
            {standalone
              ? "Generate, edit and save posing directions for this independent session. No photoshoot plan is required."
              : "Your creative brief, posing guide and shot list in one place. Confirm reference observations, then generate or refine your shoot plan."}
          </p>
        </div>
        {!standalone && (
          <Link
            className="button secondary"
            href={`/shoots/${shootId}/${poseStudio ? "plan" : "poses"}`}
          >
            {poseStudio ? "Full plan" : "Open Pose Studio"}
          </Link>
        )}
      </div>
      <a className="button secondary" href="#posing-guide">
        Jump to posing guide
      </a>
      <ReferencePanel shootId={shootId} scope={poseStudio ? "POSES" : "PLAN"} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="banner">
        <div>
          <h3>
            {standalone
              ? "Generate from this session and manual profiles"
              : "Generate from your brief and manual profiles"}
          </h3>
          <p>
            Confirmed reference observations guide generation; raw photos are
            analyzed only by your explicit consent and request. Uncited
            recommendations are labeled generated guidance. Source principles
            use only approved, rights-permitted private knowledge.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={useKnowledge}
              onChange={(e) => setKnowledge(e.target.checked)}
            />{" "}
            Retrieve approved private knowledge
          </label>
          {!poseStudio && (
            <button
              disabled={busy || !!dirty.size || jobActive}
              onClick={() => void generate(true)}
            >
              Generate complete shoot plan
            </button>
          )}
          <button
            disabled={
              busy ||
              !!dirty.size ||
              (!!job && ["QUEUED", "RUNNING"].includes(job.status))
            }
            onClick={() => void generate()}
          >
            {standalone ? "Generate posing guide" : "Generate plan"}
          </button>
        </div>
      </section>
      {poseStudio && (
        <section className="panel">
          <h2>From the knowledge library — no image needed</h2>
          <p>
            Generate original pose directions using reviewed PDF notes, your
            scene and stated people profiles. Attached images and their
            observations are excluded. Books are sources of principles, not
            illustrations to copy.
          </p>
          <button
            disabled={busy || !!dirty.size || jobActive}
            onClick={() => void generate(false, true)}
          >
            Recommend poses from knowledge
          </button>
        </section>
      )}
      {job && (
        <section className="panel">
          <p role="status">
            Planning job: {human(job.status)} · {job.progress}% · attempt{" "}
            {job.attempts}/3
          </p>
          {job.status === "FAILED" && (
            <p role="alert">
              {job.errorCode}: generation failed; your saved versions are
              retained.
            </p>
          )}
          {(job.status === "FAILED" ||
            (job.status === "QUEUED" &&
              Date.now() - Date.parse(job.updatedAt) > 60000) ||
            (job.status === "RUNNING" &&
              Date.now() - Date.parse(job.updatedAt) > 300000)) && (
            <button
              disabled={busy || job.attempts >= 3}
              onClick={() =>
                void action(async () => {
                  await receiveJob(
                    await api<TaskJob>(`jobs/${job.id}/retry`, "POST", {}),
                  );
                })
              }
            >
              Retry generation
            </button>
          )}
        </section>
      )}
      {!poseStudio && (
        <CompletePlanPanel
          shootId={shootId}
          planId={draft?.id}
          refresh={refresh}
        />
      )}
      {plans === null ? (
        <p role="status">Loading saved versions…</p>
      ) : !draft ? (
        <section className="panel empty">
          <h2>Your brief is ready for direction.</h2>
          <p>
            Generate a plan to see a creative brief, exact-person pose cards and
            a prioritized shot list.
          </p>
          {!standalone && (
            <Link href={`/shoots/${shootId}/subjects`}>
              Review people & equipment first
            </Link>
          )}
        </section>
      ) : (
        <>
          <div className="toolbar">
            <div>
              <span className="badge">
                {draft.status} · version {draft.version}
              </span>
              <p className="hint">
                {draft.provider} ·{" "}
                {draft.genericFallback
                  ? "Generic fallback; exact participants are unconfirmed"
                  : "Uses confirmed profile count"}
              </p>
            </div>
            <div className="field">
              <label htmlFor="plan-version">Version history</label>
              <select
                id="plan-version"
                value={draft.id}
                onChange={(e) => {
                  if (
                    dirty.size &&
                    !confirm("Discard unsaved edits and view another version?")
                  )
                    return;
                  setDraft(plans.find((p) => p.id === e.target.value)!);
                  setDirty(new Set());
                }}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    Version {p.version} · {p.status}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {draft.knowledgeOnly && (
            <p className="quality-note">
              Knowledge-only guide: reference image observations were excluded.
              Section regeneration keeps this mode.
            </p>
          )}
          {!latest && (
            <p className="quality-note">
              Historical version: read-only. Select the latest version to edit
              or regenerate.
            </p>
          )}
          {draft.citationStatus === "SOURCE_UNAVAILABLE" && (
            <p className="error" role="alert">
              A cited source or review revision is no longer available.
              Citations require revalidation; regenerate before approval.
            </p>
          )}
          <div className="actions">
            <button
              disabled={busy || !latest || !dirty.size}
              onClick={() =>
                void action(async () => {
                  const edits = {
                    baseVersion: draft.version,
                    ...(dirty.has("creativeBrief")
                      ? { creativeBrief: draft.creativeBrief }
                      : {}),
                    ...(dirty.has("shotList")
                      ? { shotList: draft.shotList }
                      : {}),
                    ...(Array.from(dirty).some((k) => k.startsWith("pose:"))
                      ? {
                          poseEdits: draft.poses
                            .filter((p) => dirty.has("pose:" + p.id))
                            .map((p) => ({
                              id: p.id,
                              title: p.title,
                              stepByStepDirections: p.stepByStepDirections,
                              whyItWorks: p.whyItWorks,
                            })),
                        }
                      : {}),
                  };
                  await api(
                    `shoots/${shootId}/plans/${draft.id}`,
                    "PATCH",
                    edits,
                  );
                  await load();
                })
              }
            >
              Save new version
            </button>
            <button
              className="secondary"
              disabled={
                busy ||
                !latest ||
                !!dirty.size ||
                draft.citationStatus !== "VALID"
              }
              onClick={() =>
                void action(async () => {
                  await api(
                    `shoots/${shootId}/plans/${draft.id}/approve`,
                    "POST",
                    { baseVersion: draft.version },
                  );
                  await load();
                })
              }
            >
              Approve as new version
            </button>
            <span role="status" className="hint">
              {dirty.size
                ? "Unsaved edits — save a new version"
                : "All displayed changes are saved"}
            </span>
          </div>
          <div className="workspace-stack">
            {!poseStudio && (
              <section className="panel">
                {controls("creativeBrief")}
                <h2>Creative brief</h2>
                <div className="field">
                  <label htmlFor="plan-concept">Concept</label>
                  <input
                    id="plan-concept"
                    maxLength={2000}
                    disabled={locked("creativeBrief")}
                    value={draft.creativeBrief.concept}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        creativeBrief: {
                          ...draft.creativeBrief,
                          concept: e.target.value,
                        },
                      });
                      mark("creativeBrief");
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="plan-narrative">Narrative</label>
                  <textarea
                    id="plan-narrative"
                    maxLength={2000}
                    disabled={locked("creativeBrief")}
                    value={draft.creativeBrief.narrative}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        creativeBrief: {
                          ...draft.creativeBrief,
                          narrative: e.target.value,
                        },
                      });
                      mark("creativeBrief");
                    }}
                  />
                </div>
                <p className="hint">
                  Mood: {draft.creativeBrief.mood.join(", ")}
                </p>
                {draft.creativeBrief.venueConsiderations.map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </section>
            )}
            <section className="panel" id="posing-guide">
              {controls("poses")}
              <h2>Posing guide</h2>
              <p>
                How to arrange, direct and frame every person, with original
                visual guides and comfort checks.
              </p>
              <h3>Pose cards</h3>
              <Link
                href={
                  standalone
                    ? `/tools/poses/${shootId}/files`
                    : `/shoots/${shootId}/files`
                }
              >
                Original illustrations & exports
              </Link>
              <input
                aria-label="Filter pose cards"
                placeholder="Filter by title, framing or direction…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {draft.poses
                .filter((p) =>
                  `${p.title} ${p.framing} ${p.stepByStepDirections.join(" ")}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((p, poseIndex) => (
                  <article className="media-row pose-card" key={p.id}>
                    <span className="badge">{human(p.guidanceKind)}</span>
                    <h3>{p.title}</h3>
                    <PoseSchematic
                      ids={p.subjectIds}
                      title={p.title}
                      index={poseIndex}
                    />
                    <h4>How to direct this pose</h4>
                    <ol>
                      {p.stepByStepDirections.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    <button
                      className="secondary"
                      disabled={busy || jobActive || !!dirty.size}
                      onClick={() =>
                        void action(
                          async () =>
                            await receiveJob(
                              await api<TaskJob>(
                                `shoots/${shootId}/artifacts`,
                                "POST",
                                {
                                  planId: draft.id,
                                  format: "ILLUSTRATION",
                                  poseId: p.id,
                                  idempotencyKey: crypto.randomUUID(),
                                },
                              ),
                            ),
                        )
                      }
                    >
                      Illustrate this pose
                    </button>
                    <p>{p.subjectArrangement}</p>
                    <div className="field">
                      <label htmlFor={"pose-title-" + p.id}>Pose title</label>
                      <input
                        id={"pose-title-" + p.id}
                        disabled={locked("poses")}
                        value={p.title}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            poses: draft.poses.map((x) =>
                              x.id === p.id
                                ? { ...x, title: e.target.value }
                                : x,
                            ),
                          });
                          mark("pose:" + p.id);
                        }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={"pose-directions-" + p.id}>
                        How to direct the subjects (one instruction per line)
                      </label>
                      <textarea
                        id={"pose-directions-" + p.id}
                        disabled={locked("poses")}
                        value={p.stepByStepDirections.join("\n")}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            poses: draft.poses.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    stepByStepDirections:
                                      e.target.value.split("\n"),
                                  }
                                : x,
                            ),
                          });
                          mark("pose:" + p.id);
                        }}
                      />
                    </div>
                    <h4>Why this works</h4>
                    <p>{p.whyItWorks}</p>
                    <p className="hint">
                      {p.framing} · {p.cameraHeight} · {p.lensGuidance}
                    </p>
                    {p.ageSafetyNotes.map((t) => (
                      <p className="quality-note" key={t}>
                        {t}
                      </p>
                    ))}
                    {p.sourceNotes.length ? (
                      <details>
                        <summary>
                          Reviewed source principles (private provenance)
                        </summary>
                        {p.sourceNotes.map((n) => (
                          <div key={n.reference.chunkId}>
                            <p>{n.summary}</p>
                            <p className="hint">
                              {n.reference.documentTitle} ·{" "}
                              {n.reference.pageStart
                                ? `page ${n.reference.pageStart}`
                                : `lines ${n.reference.lineStart}–${n.reference.lineEnd}`}{" "}
                              · chunk {n.reference.chunkId.slice(0, 10)} ·
                              review {n.reference.chunkRevision}
                            </p>
                          </div>
                        ))}
                      </details>
                    ) : (
                      <p className="hint">
                        No source citation: generated or user-edited guidance.
                      </p>
                    )}
                    <p className="hint">
                      Generate a private original schematic on demand, or follow
                      the face-spacing guide above. Original book illustrations
                      are never displayed here.
                    </p>
                  </article>
                ))}
            </section>
            {!poseStudio && (
              <section className="panel">
                {controls("shotList")}
                <h2>Shot list</h2>
                {draft.shotList.map((s) => (
                  <div className="media-row" key={s.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        disabled={locked("shotList")}
                        checked={s.completed}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            shotList: draft.shotList.map((x) =>
                              x.id === s.id
                                ? { ...x, completed: e.target.checked }
                                : x,
                            ),
                          });
                          mark("shotList");
                        }}
                      />
                      {s.description}
                    </label>
                    <span className="hint">
                      {s.priority} · about {s.estimatedMinutes} minutes
                    </span>
                    <div className="field">
                      <label htmlFor={"shot-" + s.id}>Shot description</label>
                      <input
                        id={"shot-" + s.id}
                        disabled={locked("shotList")}
                        value={s.description}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            shotList: draft.shotList.map((x) =>
                              x.id === s.id
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          });
                          mark("shotList");
                        }}
                      />
                    </div>
                  </div>
                ))}
              </section>
            )}
            <section className="panel">
              <h2>Assumptions & limitations</h2>
              {draft.limitations.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </section>
          </div>
        </>
      )}
    </>
  );
}
function SectionControls({
  section,
  plan,
  disabled,
  onLock,
  onRegenerate,
}: {
  section: "creativeBrief" | "poses" | "shotList";
  plan: ShootPlan;
  disabled: boolean;
  onLock: (s: "creativeBrief" | "poses" | "shotList") => Promise<void>;
  onRegenerate: (s: "creativeBrief" | "poses" | "shotList") => Promise<void>;
}) {
  return (
    <div className="actions">
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => void onLock(section)}
      >
        {plan.lockedSections.includes(section) ? "Unlock" : "Lock"}{" "}
        {section === "creativeBrief"
          ? "brief"
          : section === "shotList"
            ? "shot list"
            : "poses"}
      </button>
      <button
        className="secondary"
        disabled={disabled || plan.lockedSections.includes(section)}
        onClick={() => void onRegenerate(section)}
      >
        Regenerate{" "}
        {section === "creativeBrief"
          ? "brief"
          : section === "shotList"
            ? "shot list"
            : "poses"}
      </button>
    </div>
  );
}
