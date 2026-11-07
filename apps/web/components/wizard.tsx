"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  categories,
  defaults,
  shootSchema,
  type Shoot,
  type ShootInput,
} from "@framecraft/shared";
import { api, human } from "./client";
const steps = ["Basics", "People", "Environment", "Review"];
export function Wizard({ id }: { id?: string }) {
  const [form, setForm] = useState<ShootInput>(defaults);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Not saved yet");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(0);
  const record = useRef<{ id?: string; revision?: number }>({ id });
  const version = useRef(0);
  const lifecycle = useRef(0);
  const inFlight = useRef(false);
  const latest = useRef(form);
  latest.current = form;
  useEffect(() => {
    if (id && ready && record.current.id === id) return;
    let active = true;
    lifecycle.current++;
    version.current = 0;
    inFlight.current = false;
    record.current = { id };
    setReady(false);
    setDirty(false);
    setSaving(false);
    setBlocked(false);
    setError("");
    if (id) {
      setStatus("Loading…");
      api<Shoot>("shoots/" + id)
        .then((s) => {
          if (!active) return;
          setForm(s);
          record.current = { id: s.id, revision: s.revision };
          setStatus("All changes saved");
          setReady(true);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    } else {
      setForm({
        ...defaults,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setStatus("Not saved yet");
      setReady(true);
    }
    return () => {
      active = false;
    };
  }, [id]);
  const clean = () => {
    const {
      name,
      description,
      shootType,
      portraitCategory,
      subjectCategory,
      subjectCount,
      date,
      time,
      timezone,
      durationMinutes,
      settings,
    } = latest.current;
    return {
      name,
      description,
      shootType,
      portraitCategory,
      subjectCategory,
      subjectCount,
      date,
      time,
      timezone,
      durationMinutes,
      settings,
    };
  };
  async function save() {
    if (inFlight.current || blocked) return;
    const parsed = shootSchema.safeParse(clean());
    if (!parsed.success) {
      setStatus("Changes need attention");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setStatus("Saving…");
    const v = version.current;
    const epoch = lifecycle.current;
    try {
      const r = record.current;
      const s = await api<Shoot>(
        "shoots" + (r.id ? "/" + r.id : ""),
        r.id ? "PATCH" : "POST",
        { ...parsed.data, ...(r.id ? { revision: r.revision } : {}) },
      );
      if (epoch !== lifecycle.current) return;
      record.current = { id: s.id, revision: s.revision };
      if (!id) window.history.replaceState(null, "", "/shoots/" + s.id);
      if (v === version.current) {
        setDirty(false);
        setStatus("All changes saved");
      } else setStatus("Unsaved changes");
      setError("");
    } catch (e) {
      if (epoch !== lifecycle.current) return;
      const message = (e as Error).message;
      setError(message);
      if (message.includes("changed elsewhere")) setBlocked(true);
      setStatus("Not saved — retry available");
    } finally {
      if (epoch === lifecycle.current) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }
  useEffect(() => {
    if (!ready || !dirty || saving || blocked || error) return;
    const t = setTimeout(() => {
      void save();
    }, 700);
    return () => clearTimeout(t); /* save reads current values from refs */
  }, [form, ready, dirty, saving, blocked, retry, error]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (version.current && (dirty || inFlight.current)) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    // Next.js link transitions do not trigger beforeunload.
    const guard = (event: MouseEvent) => {
      if (
        (!dirty && !inFlight.current) ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.href === window.location.href
      )
        return;
      if (
        !window.confirm(
          "Your latest edits have not been saved. Leave this brief?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty]);
  function update<K extends keyof ShootInput>(key: K, value: ShootInput[K]) {
    version.current++;
    setDirty(true);
    setStatus("Unsaved changes");
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setting(
    key: keyof ShootInput["settings"],
    value: string | string[],
  ) {
    update("settings", { ...form.settings, [key]: value });
  }
  const validation = shootSchema.safeParse(clean());
  const issues = validation.success ? [] : validation.error.issues;
  const fields = (
    label: string,
    key: "name" | "description" | "date" | "time" | "timezone",
    type = "text",
  ) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      {key === "description" ? (
        <textarea
          id={key}
          value={form[key]}
          maxLength={2000}
          onChange={(e) => update(key, e.target.value)}
        />
      ) : (
        <input
          id={key}
          type={type}
          value={form[key]}
          maxLength={key === "name" ? 120 : undefined}
          onChange={(e) => update(key, e.target.value)}
        />
      )}
    </div>
  );
  if (!ready)
    return (
      <section className="panel">
        {error ? (
          <p role="alert" className="error">
            {error} <Link href="/dashboard">Back to workspace</Link>
          </p>
        ) : (
          <p role="status">Loading your brief…</p>
        )}
      </section>
    );
  return (
    <>
      <Link className="hint" href="/dashboard">
        ← All shoots
      </Link>
      <div className="hero">
        <div>
          <p className="eyebrow">A considered beginning</p>
          <h1>{id ? "Refine your shoot." : "Let’s shape your shoot."}</h1>
          <p>A few details now. More room for creativity on the day.</p>
        </div>
        <span className="badge" role="status" aria-live="polite">
          {status}
        </span>
      </div>
      {record.current.id && (
        <div className="actions" style={{ marginBottom: 24 }}>
          <Link
            className="button secondary"
            href={`/shoots/${record.current.id}/subjects`}
          >
            People, photos & equipment
          </Link>
          <Link
            className="button secondary"
            href={`/shoots/${record.current.id}/plan`}
          >
            Plan & Pose Studio
          </Link>
          <Link href={`/shoots/${record.current.id}/files`}>Files & exports</Link>
          <Link href={`/shoots/${record.current.id}/lighting`}>
            Lighting Lab
          </Link>
          <Link href={`/shoots/${record.current.id}/wardrobe`}>
            Wardrobe Stylist
          </Link>
        </div>
      )}
      <div className="steps" aria-label="Shoot setup steps">
        {steps.map((s, i) => (
          <button
            key={s}
            aria-label={`${i + 1}. ${s}`}
            aria-current={step === i ? "step" : undefined}
            onClick={() => setStep(i)}
          >
            {i + 1}
            <span> · {s}</span>
          </button>
        ))}
      </div>
      <div className="wizard-layout">
        <section className="panel">
          <h2 tabIndex={-1}>{steps[step]}</h2>
          {error && (
            <div className="error" role="alert">
              {error}{" "}
              {blocked ? (
                <button
                  className="secondary"
                  onClick={() => window.location.reload()}
                >
                  Reopen latest
                </button>
              ) : (
                <button
                  className="secondary"
                  onClick={() => {
                    setRetry((r) => r + 1);
                    void save();
                  }}
                >
                  Retry save
                </button>
              )}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 3) setStep(step + 1);
              else void save();
            }}
          >
            {step === 0 && (
              <>
                {fields("Shoot name *", "name")}
                {fields("Description (optional)", "description")}
                <div className="row">
                  <div className="field">
                    <label htmlFor="shootType">Environment</label>
                    <select
                      id="shootType"
                      value={form.shootType}
                      onChange={(e) =>
                        update(
                          "shootType",
                          e.target.value as ShootInput["shootType"],
                        )
                      }
                    >
                      <option value="OUTDOOR">Outdoor</option>
                      <option value="INDOOR">Indoor</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="portraitCategory">Shoot format</label>
                    <select
                      id="portraitCategory"
                      value={form.portraitCategory}
                      onChange={(e) => {
                        const value = e.target
                          .value as ShootInput["portraitCategory"];
                        update("portraitCategory", value);
                        update(
                          "subjectCount",
                          value === "PORTRAIT_INDIVIDUAL"
                            ? 1
                            : value === "PORTRAIT_GROUP"
                              ? 2
                              : 1,
                        );
                      }}
                    >
                      {[
                        "PORTRAIT_INDIVIDUAL",
                        "PORTRAIT_GROUP",
                        "PORTFOLIO",
                      ].map((v) => (
                        <option key={v} value={v}>
                          {human(v)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="row">
                  {fields("Shoot date (optional)", "date", "date")}
                  {fields("Start time (optional)", "time", "time")}
                </div>
                {fields("Time zone", "timezone")}
                <div className="field">
                  <label htmlFor="duration">
                    Duration in minutes (optional)
                  </label>
                  <input
                    id="duration"
                    type="number"
                    min={15}
                    max={480}
                    value={form.durationMinutes ?? ""}
                    onChange={(e) =>
                      update(
                        "durationMinutes",
                        e.target.value ? Number(e.target.value) : undefined,
                      )
                    }
                  />
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <p className="muted">
                  A preset helps shape the brief. It does not define anyone’s
                  identity.
                </p>
                <div className="field">
                  <label htmlFor="subjectCategory">Subject category</label>
                  <select
                    id="subjectCategory"
                    value={form.subjectCategory}
                    onChange={(e) =>
                      update(
                        "subjectCategory",
                        e.target.value as ShootInput["subjectCategory"],
                      )
                    }
                  >
                    {categories.map((v) => (
                      <option key={v} value={v}>
                        {human(v)}
                      </option>
                    ))}
                  </select>
                </div>
                {form.portraitCategory !== "PORTRAIT_INDIVIDUAL" && (
                  <div className="field">
                    <label htmlFor="count">Number of people (optional)</label>
                    <input
                      id="count"
                      type="number"
                      min={form.portraitCategory === "PORTRAIT_GROUP" ? 2 : 1}
                      max={20}
                      value={form.subjectCount ?? ""}
                      onChange={(e) =>
                        update(
                          "subjectCount",
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    />
                    <span className="hint">
                      2–6 people will receive the strongest tailored guidance.
                      Leave blank for a generic brief.
                    </span>
                  </div>
                )}
                <div className="banner">
                  <p>
                    No photos needed. Detailed subject profiles and consent
                    controls will be added in the next milestone.
                  </p>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="field">
                  <label htmlFor="lightMode">Lighting preference</label>
                  <select
                    id="lightMode"
                    value={form.settings.lightMode}
                    onChange={(e) => setting("lightMode", e.target.value)}
                  >
                    {["NATURAL", "ARTIFICIAL", "MIXED"].map((v) => (
                      <option key={v} value={v}>
                        {human(v)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="scene">Scene</label>
                  <input
                    id="scene"
                    value={form.settings.sceneCategory}
                    maxLength={120}
                    list="scenes"
                    onChange={(e) => setting("sceneCategory", e.target.value)}
                  />
                  <datalist id="scenes">
                    {(form.shootType === "INDOOR"
                      ? [
                          "Home",
                          "Studio backdrop",
                          "Window-lit room",
                          "Office",
                          "Lifestyle interior",
                        ]
                      : [
                          "Garden",
                          "Beach",
                          "Forest",
                          "Urban street",
                          "Architecture",
                          "Open landscape",
                          "Other",
                        ]
                    ).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="details">
                    Surroundings & practical notes
                  </label>
                  <textarea
                    id="details"
                    maxLength={2000}
                    value={form.settings.sceneDetails}
                    placeholder="Background, available shade, window direction, access…"
                    onChange={(e) => setting("sceneDetails", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="occasion">Occasion (optional)</label>
                  <input
                    id="occasion"
                    maxLength={200}
                    value={form.settings.occasion}
                    onChange={(e) => setting("occasion", e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="direction">
                    Visual direction (comma-separated)
                  </label>
                  <input
                    id="direction"
                    value={form.settings.creativeTags.join(",")}
                    onChange={(e) =>
                      setting(
                        "creativeTags",
                        e.target.value.split(",").slice(0, 12),
                      )
                    }
                  />
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <h3>{form.name}</h3>
                <p>{form.description || "No description added."}</p>
                <dl>
                  <dt>Format</dt>
                  <dd>
                    {human(form.shootType)} · {human(form.portraitCategory)}
                  </dd>
                  <dt>People</dt>
                  <dd>
                    {human(form.subjectCategory)} ·{" "}
                    {form.subjectCount ?? "Unspecified"} people
                  </dd>
                  <dt>Setting</dt>
                  <dd>
                    {form.settings.sceneCategory} ·{" "}
                    {human(form.settings.lightMode)} light
                  </dd>
                  <dt>Schedule</dt>
                  <dd>
                    {form.date || "Date flexible"} {form.time} · {form.timezone}
                  </dd>
                  <dt>Direction</dt>
                  <dd>
                    {form.settings.creativeTags.join(", ") || "Open to ideas"}
                  </dd>
                </dl>
                <p className="hint">
                  This milestone saves your brief. Structured plan generation
                  will arrive with FC-013; no AI requests are sent.
                </p>
              </>
            )}
            {issues.length > 0 && (
              <div role="alert" className="error">
                {issues.map((i) => (
                  <p key={i.path.join(".")}>
                    {i.path.join(".")}: {i.message}
                  </p>
                ))}
              </div>
            )}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={
                  step === 3 && (saving || blocked || !validation.success)
                }
              >
                {step === 3
                  ? saving
                    ? "Saving…"
                    : "Save brief"
                  : "Continue →"}
              </button>
            </div>
          </form>
          {step === 3 && record.current.id && (
            <div className="actions">
              <Link className="button secondary" href="/dashboard">
                Return to workspace
              </Link>
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm("Delete this shoot brief?")) return;
                  try {
                    await api("shoots/" + record.current.id, "DELETE");
                    window.location.assign("/dashboard");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Delete shoot
              </button>
            </div>
          )}
        </section>
        <aside className="panel summary">
          <p className="eyebrow">Your brief, at a glance</p>
          <h3>{form.name || "Untitled shoot"}</h3>
          <dl>
            <dt>The setting</dt>
            <dd>
              {human(form.shootType)} / {form.settings.sceneCategory}
            </dd>
            <dt>The people</dt>
            <dd>
              {form.subjectCount ?? "Unspecified"} ·{" "}
              {human(form.subjectCategory)}
            </dd>
            <dt>The light</dt>
            <dd>{human(form.settings.lightMode)}</dd>
            <dt>The occasion</dt>
            <dd>{form.settings.occasion || "Something worth remembering"}</dd>
          </dl>
          <hr
            style={{
              border: 0,
              borderTop: "1px solid var(--line)",
              margin: "26px 0",
            }}
          />
          <p className="hint">
            Drafts save automatically after you make changes. Your details stay
            private.
          </p>
        </aside>
      </div>
    </>
  );
}
