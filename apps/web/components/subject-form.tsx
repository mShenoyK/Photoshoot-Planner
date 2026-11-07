"use client";
import { useState } from "react";
import {
  ageGroups,
  blankSubject,
  subjectSchema,
  type Subject,
  type SubjectInput,
} from "@framecraft/shared/inputs";
import { api, human } from "./client";
export function SubjectForm({
  shootId,
  existing,
  onSaved,
  onCancel,
}: {
  shootId: string;
  existing?: Subject;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SubjectInput>(
    existing
      ? subjectSchema.parse(
          Object.fromEntries(
            Object.keys(blankSubject)
              .concat(["ageYears", "budget"])
              .map((k) => [k, existing[k as keyof Subject]]),
          ),
        )
      : blankSubject,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>{existing ? "Edit subject" : "Add a person"}</h2>
      <p className="hint">
        All details are voluntarily stated. You can plan without photographs.
        Editing a saved profile withdraws its existing consent and removes
        associated photos.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = subjectSchema.safeParse(form);
          if (!parsed.success) {
            setError(
              parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join(" "),
            );
            return;
          }
          if (
            existing &&
            !confirm(
              "Save these profile changes? Existing photo consent will be withdrawn and related photos removed.",
            )
          )
            return;
          setBusy(true);
          setError("");
          try {
            await api(
              `shoots/${shootId}/subjects${existing ? "/" + existing.id : ""}`,
              existing ? "PATCH" : "POST",
              parsed.data,
            );
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="subject-label">Name or label</label>
          <input
            id="subject-label"
            value={form.label}
            maxLength={100}
            required
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="age-band">Stated age band</label>
            <select
              id="age-band"
              value={form.ageGroup}
              onChange={(e) =>
                setForm({
                  ...form,
                  ageGroup: e.target.value as SubjectInput["ageGroup"],
                })
              }
            >
              {ageGroups.map((v) => (
                <option key={v} value={v}>
                  {human(v)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="age-years">Stated age in years (optional)</label>
            <input
              id="age-years"
              type="number"
              min={0}
              max={120}
              step="0.1"
              value={form.ageYears ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  ageYears: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>
        </div>
        {(
          [
            "selfDescribedGender",
            "clothingSize",
            "fitComfort",
            "preferredColors",
            "avoidedColors",
            "stylePreferences",
            "mobilityNotes",
          ] as const
        ).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={key}>
              {
                {
                  selfDescribedGender: "Self-described gender (optional)",
                  clothingSize: "Clothing sizes (optional)",
                  fitComfort: "Fit and comfort priorities",
                  preferredColors: "Preferred colors",
                  avoidedColors: "Avoided colors",
                  stylePreferences: "Style and cultural preferences",
                  mobilityNotes:
                    "Mobility, footwear and accessibility considerations",
                }[key]
              }
            </label>
            <input
              id={key}
              maxLength={
                key === "selfDescribedGender" || key === "clothingSize"
                  ? 100
                  : key.includes("Colors")
                    ? 300
                    : 1000
              }
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="row">
          <div className="field">
            <label htmlFor="outfit-budget">Outfit budget (optional)</label>
            <input
              id="outfit-budget"
              type="number"
              min={0}
              max={1000000}
              value={form.budget ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  budget: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency code</label>
            <input
              id="currency"
              maxLength={3}
              value={form.currency}
              onChange={(e) =>
                setForm({ ...form, currency: e.target.value.toUpperCase() })
              }
            />
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save subject"}</button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
