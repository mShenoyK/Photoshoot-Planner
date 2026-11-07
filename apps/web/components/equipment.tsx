"use client";
import { useEffect, useState } from "react";
import {
  canonPreset,
  type CameraKit,
  equipmentSchema,
} from "@framecraft/shared/inputs";
import { api } from "./client";
export function EquipmentPanel({
  shootId,
  onSelected,
}: {
  shootId?: string;
  onSelected?: () => void;
}) {
  const [kits, setKits] = useState<CameraKit[] | null>(null);
  const [form, setForm] = useState(canonPreset);
  const [edit, setEdit] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = () =>
    api<CameraKit[]>("equipment")
      .then(setKits)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <p className="eyebrow">Ready for the session</p>
      <h2>Camera kits</h2>
      <p className="muted">
        Save your actual equipment. Choosing a kit copies its current details
        into this shoot.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button className="secondary" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            await api("equipment/canon-preset", "POST", {});
            setNotice("Canon portrait kit added.");
          })
        }
      >
        Add Canon portrait preset
      </button>
      {kits === null ? (
        <p role="status">Loading camera kits…</p>
      ) : !kits.length ? (
        <p className="hint">
          No saved kits. Add the Canon preset or create your own below.
        </p>
      ) : (
        <div className="input-cards">
          {kits.map((k) => (
            <article className="panel" key={k.id}>
              <h3>{k.name}</h3>
              <p>
                {k.body}
                <br />
                {k.lens}
                <br />
                {k.flashCount} flashes · {k.modifiers}
              </p>
              <p className="hint">{k.notes}</p>
              <div className="actions">
                {shootId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(`shoots/${shootId}/equipment`, "PATCH", {
                          kitId: k.id,
                        });
                        setNotice(`${k.name} selected for this shoot.`);
                        onSelected?.();
                      })
                    }
                  >
                    Use for this shoot
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    setEdit(k.id);
                    const { id, ownerId, ...rest } = k;
                    void id;
                    void ownerId;
                    setForm(rest);
                  }}
                >
                  Edit kit
                </button>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this reusable kit? Shoot snapshots will be retained.",
                      )
                    )
                      void action(async () => {
                        await api("equipment/" + k.id, "DELETE");
                      });
                  }}
                >
                  Delete kit
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <details open={!!edit}>
        <summary>{edit ? "Edit camera kit" : "Create a custom kit"}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = equipmentSchema.safeParse(form);
            if (!parsed.success) {
              setError(parsed.error.issues.map((i) => i.message).join(" "));
              return;
            }
            void action(async () => {
              await api(
                "equipment" + (edit ? "/" + edit : ""),
                edit ? "PATCH" : "POST",
                parsed.data,
              );
              setEdit(undefined);
              setForm(canonPreset);
              setNotice("Camera kit saved.");
            });
          }}
        >
          {(
            [
              "name",
              "body",
              "sensorFormat",
              "lens",
              "modifiers",
              "notes",
            ] as const
          ).map((key) => (
            <div className="field" key={key}>
              <label htmlFor={"kit-" + key}>
                {
                  {
                    name: "Kit name",
                    body: "Camera body",
                    sensorFormat: "Sensor format",
                    lens: "Lens",
                    modifiers: "Modifiers",
                    notes: "Equipment notes",
                  }[key]
                }
              </label>
              <input
                id={"kit-" + key}
                maxLength={key === "notes" ? 1000 : 500}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </div>
          ))}
          <div className="field">
            <label htmlFor="kit-flashes">Number of flashes</label>
            <input
              id="kit-flashes"
              type="number"
              min={0}
              max={20}
              value={form.flashCount}
              onChange={(e) =>
                setForm({ ...form, flashCount: Number(e.target.value) })
              }
            />
          </div>
          <div className="actions">
            <button disabled={busy}>
              {busy ? "Saving…" : "Save camera kit"}
            </button>
            {edit && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEdit(undefined);
                  setForm(canonPreset);
                }}
              >
                Cancel editing
              </button>
            )}
          </div>
        </form>
      </details>
      {shootId && (
        <button
          disabled={busy}
          className="secondary"
          onClick={() =>
            void action(async () => {
              await api(`shoots/${shootId}/equipment`, "PATCH", {
                kitId: null,
              });
              setNotice("Equipment selection cleared.");
              onSelected?.();
            })
          }
        >
          Clear shoot equipment
        </button>
      )}
    </section>
  );
}
