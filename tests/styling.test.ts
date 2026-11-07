import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaults } from "../packages/shared/src/shoot";
import { blankSubject, canonPreset } from "../packages/shared/src/inputs";
import { sceneSchema } from "../packages/shared/src/styling";
import { renderLightingSvg } from "../packages/shared/src/lighting-svg";
import { store } from "../apps/web/lib/store";
import { withShoot } from "../apps/web/lib/input-repository";
import { changeStyling, readStyling } from "../apps/web/lib/styling-service";
import { lightingRules, wardrobeRules } from "../apps/web/lib/styling-rules";
import { handle } from "../apps/web/lib/api";
import { token } from "../apps/web/lib/auth";
let dir: string;
let owner: string;
let id: string;
let ids: string[];
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fc-styling-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(dir, "data.json");
  owner = (
    await store.createUser(`style-${randomUUID()}@example.com`, "unused")
  ).id;
  const shoot = await store.save(owner, {
    ...defaults,
    name: "Four person family",
    shootType: "INDOOR",
    portraitCategory: "PORTRAIT_GROUP",
    subjectCategory: "FAMILY_MIXED",
    subjectCount: 4,
    settings: { ...defaults.settings, lightMode: "ARTIFICIAL" },
  });
  id = shoot!.id;
  ids = Array.from({ length: 4 }, () => randomUUID());
  await withShoot(owner, id, (s) => {
    s.subjects = ids.map((id, i) => ({
      ...blankSubject,
      id,
      label: `Person ${i + 1}`,
      ageGroup: i < 2 ? "ADULT" : "CHILD",
      fitComfort: i === 3 ? "Soft seams, seated comfort" : "",
      avoidedColors: "red",
      consentHistory: [],
    }));
    s.cameraKit = { ...canonPreset, sourceKitId: randomUUID() };
  });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("renders four exact subjects, both projections, deterministic escaped SVG and equipment-aware monochrome settings", async () => {
  const v = await changeStyling(owner, id, {
    action: "LIGHTING",
    baseRevision: 0,
    recipe: "STACKED_MONOCHROME",
    fill: true,
  });
  const l = v.latest!.lighting!;
  expect(l.scene.subjects.map((s) => s.id)).toEqual(ids);
  expect(l.scene.lights).toHaveLength(2);
  expect(l.settings.iso).toBe("100");
  expect(l.settings.shutter).toContain("1/160");
  expect(l.settings.focalLength).toContain("85–105");
  expect(l.notes.join(" ")).toContain("Never suspend");
  const scene = structuredClone(l.scene);
  scene.subjects[0].label = '<script>alert("x")</script>';
  for (const view of ["top", "side"] as const) {
    const svg = renderLightingSvg(scene, view);
    expect(svg).toBe(renderLightingSvg(scene, view));
    expect(svg.match(/data-subject=/g)).toHaveLength(4);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("href=");
  }
  expect(renderLightingSvg(scene, "top")).not.toBe(
    renderLightingSvg(scene, "side"),
  );
});
it("creates 3 choices per mixed-age subject without photos or consent and respects comfort and color avoidance", async () => {
  const v = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: 1,
  });
  expect(v.latest!.wardrobe!.looks).toHaveLength(4);
  for (const l of v.latest!.wardrobe!.looks) {
    expect(l.candidates).toHaveLength(3);
    expect(l.candidates.every((c) => c.color !== "red")).toBe(true);
  }
  expect(v.latest!.wardrobe!.looks[3].candidates[0].comfort).toContain(
    "Soft seams",
  );
});
it("swaps, locks and rebalances around hero while retaining the entire locked look", async () => {
  let v = await readStyling(owner, id);
  const look = v.latest!.wardrobe!.looks[0];
  v = await changeStyling(owner, id, {
    action: "SELECT",
    baseRevision: v.latest!.revision,
    subjectId: ids[0],
    candidateId: look.candidates[1].id,
    locked: true,
  });
  const locked = structuredClone(v.latest!.wardrobe!.looks[0]);
  await expect(
    changeStyling(owner, id, {
      action: "SELECT",
      baseRevision: v.latest!.revision,
      subjectId: ids[0],
      candidateId: look.candidates[2].id,
      locked: true,
    }),
  ).rejects.toMatchObject({ code: "LOCKED" });
  v = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: v.latest!.revision,
    heroSubjectId: ids[0],
  });
  expect(v.latest!.wardrobe!.looks[0]).toEqual(locked);
  expect(v.latest!.wardrobe!.palette).toContain(locked.candidates[1].color);
  expect(v.versions[1].wardrobe!.looks[0].locked).toBe(false);
});
it("saves editable uncertain observations and applies comfort notes only after explicit rebalance", async () => {
  let v = await readStyling(owner, id);
  v = await changeStyling(owner, id, {
    action: "OBSERVATION",
    baseRevision: v.latest!.revision,
    observation: {
      subjectId: ids[1],
      visibleColors: "navy",
      fabricNotes: "avoid itchy wool",
      fitNotes: "seated waist comfort",
      uncertainty: "warm cast, confirm in daylight",
      source: "USER_REPORTED",
    },
  });
  v = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: v.latest!.revision,
  });
  expect(v.latest!.wardrobe!.looks[1].candidates[0].comfort).toContain(
    "seated waist comfort",
  );
  expect(v.latest!.wardrobe!.looks[1].candidates[0].alternatives).toContain(
    "avoid itchy wool",
  );
  await expect(
    changeStyling(owner, id, {
      action: "OBSERVATION",
      baseRevision: v.latest!.revision,
      observation: {
        subjectId: ids[1],
        visibleColors: "",
        fabricNotes: "",
        fitNotes: "",
        uncertainty: "",
        source: "PHOTO",
        personality: "extrovert",
      },
    }),
  ).rejects.toThrow();
});
it("rejects concurrent stale writes, foreign subject IDs and malformed/equipment-incompatible scenes", async () => {
  const v = await readStyling(owner, id);
  const revision = v.latest!.revision;
  await expect(
    changeStyling(owner, id, { action: "WARDROBE", baseRevision: 0 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    changeStyling(owner, id, {
      action: "SELECT",
      baseRevision: revision,
      subjectId: randomUUID(),
      candidateId: "x",
      locked: false,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const s = structuredClone(v.latest!.lighting!.scene);
  s.subjects.pop();
  await expect(
    changeStyling(owner, id, {
      action: "SCENE",
      baseRevision: revision,
      scene: s,
    }),
  ).rejects.toMatchObject({ code: "SUBJECT_MISMATCH" });
  s.subjects.push(v.latest!.lighting!.scene.subjects[3]);
  s.camera.x = 11;
  expect(sceneSchema.safeParse(s).success).toBe(false);
  s.camera.x = 3;
  s.lights.push({ ...s.lights[0], id: "third" });
  await expect(
    changeStyling(owner, id, {
      action: "SCENE",
      baseRevision: revision,
      scene: s,
    }),
  ).rejects.toMatchObject({ code: "EQUIPMENT_MISMATCH" });
});
it("denies cross-owner reads/writes and SVG downloads at HTTP boundary", async () => {
  const cookie = `fc_session=${await token(randomUUID())}`;
  for (const [method, route] of [
    ["GET", "styling"],
    ["POST", "styling"],
    ["GET", "styling/top.svg"],
    ["GET", "styling/side.svg"],
  ]) {
    const r = await handle(
      new Request(`http://localhost:3000/api/v1/shoots/${id}/${route}`, {
        method,
        headers: { cookie, origin: "http://localhost:3000" },
        ...(method === "POST"
          ? { body: JSON.stringify({ action: "WARDROBE", baseRevision: 0 }) }
          : {}),
      }),
    );
    expect(r.status).toBe(404);
  }
  const r = await handle(
    new Request(`http://localhost:3000/api/v1/shoots/${id}/styling/top.svg`, {
      headers: { cookie: `fc_session=${await token(owner)}` },
    }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
});
it("uses natural/window/mixed fallbacks and never assumes unavailable flashes", async () => {
  await withShoot(owner, id, (s, shoot) => {
    const natural = lightingRules(
      {
        ...shoot,
        shootType: "OUTDOOR",
        settings: { ...shoot.settings, lightMode: "NATURAL" },
      },
      { ...s, cameraKit: undefined },
      "CONTEXT",
      true,
    );
    expect(natural.scene.lights[0].kind).toBe("SHADE");
    expect(natural.scene.lights).toHaveLength(1);
    expect(natural.notes.join(" ")).toContain("open shade");
    const indoor = lightingRules(
      { ...shoot, settings: { ...shoot.settings, lightMode: "NATURAL" } },
      s,
      "CONTEXT",
      false,
    );
    expect(indoor.scene.lights[0].kind).toBe("WINDOW");
    const mixed = lightingRules(
      { ...shoot, settings: { ...shoot.settings, lightMode: "MIXED" } },
      s,
      "CONTEXT",
      true,
    );
    expect(mixed.notes.join(" ")).toContain("Meter ambient first");
    expect(() =>
      lightingRules(
        shoot,
        { ...s, cameraKit: undefined },
        "STACKED_MONOCHROME",
        false,
      ),
    ).toThrow();
  });
});
it("keeps section staleness independent and appends scene edits without mutating old versions", async () => {
  await withShoot(owner, id, (s) => {
    s.subjects[1].fitComfort = "Updated comfort";
  });
  let v = await readStyling(owner, id);
  expect(v.stale).toBe(true);
  v = await changeStyling(owner, id, {
    action: "LIGHTING",
    baseRevision: v.latest!.revision,
    recipe: "CONTEXT",
  });
  expect(v.stale).toBe(true);
  await expect(
    changeStyling(owner, id, {
      action: "SELECT",
      baseRevision: v.latest!.revision,
      subjectId: ids[1],
      candidateId: v.latest!.wardrobe!.looks[1].selectedId,
      locked: true,
    }),
  ).rejects.toMatchObject({ code: "STALE_INPUTS" });
  v = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: v.latest!.revision,
  });
  expect(v.stale).toBe(false);
  const scene = structuredClone(v.latest!.lighting!.scene);
  scene.camera.x = 3.5;
  v = await changeStyling(owner, id, {
    action: "SCENE",
    baseRevision: v.latest!.revision,
    scene,
  });
  expect(v.latest!.lighting!.scene.camera.x).toBe(3.5);
  expect(v.versions.at(-2)!.lighting!.scene.camera.x).toBe(3);
});
it("retains a swapped hero outfit even when unlocked and distributes unlocked palette colors", async () => {
  let v = await readStyling(owner, id);
  const look = v.latest!.wardrobe!.looks[1];
  v = await changeStyling(owner, id, {
    action: "SELECT",
    baseRevision: v.latest!.revision,
    subjectId: ids[1],
    candidateId: look.candidates[2].id,
    locked: false,
  });
  const hero = structuredClone(v.latest!.wardrobe!.looks[1]);
  v = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: v.latest!.revision,
    heroSubjectId: ids[1],
  });
  expect(v.latest!.wardrobe!.looks[1]).toEqual(hero);
  expect(
    new Set(
      v.latest!.wardrobe!.looks.map(
        (l) => l.candidates.find((c) => c.id === l.selectedId)!.color,
      ),
    ).size,
  ).toBeGreaterThan(1);
});
it("supports generic lighting with omitted counts and prevents lock/color preference conflicts", async () => {
  await withShoot(owner, id, (s, shoot) => {
    const l = lightingRules(
      { ...shoot, subjectCount: undefined },
      { ...s, subjects: [] },
      "CONTEXT",
      false,
    );
    expect(l.scene.subjects).toHaveLength(1);
    expect(l.notes.join(" ")).toContain("Generic subject markers");
  });
  let v = await readStyling(owner, id);
  const look = v.latest!.wardrobe!.looks[0];
  const color = look.candidates.find((c) => c.id === look.selectedId)!.color;
  await withShoot(owner, id, (s) => {
    s.subjects[0].avoidedColors = color;
  });
  await expect(
    changeStyling(owner, id, {
      action: "WARDROBE",
      baseRevision: v.latest!.revision,
    }),
  ).rejects.toMatchObject({ code: "LOCK_CONFLICT" });
  v = await changeStyling(owner, id, {
    action: "SELECT",
    baseRevision: v.latest!.revision,
    subjectId: ids[0],
    candidateId: look.selectedId,
    locked: false,
  });
  v = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: v.latest!.revision,
  });
  expect(
    v.latest!.wardrobe!.looks[0].candidates.some((c) => c.color === color),
  ).toBe(false);
});

it("accepts maximum-length valid manual comfort, scene and uncertain observation inputs", async () => {
  await withShoot(owner, id, (s, shoot) => {
    const p = {
      ...s.subjects[1],
      fitComfort: "c".repeat(1000),
      mobilityNotes: "m".repeat(1000),
      stylePreferences: "s".repeat(1000),
      preferredColors: "p".repeat(300),
      avoidedColors: "",
    };
    const old = {
      palette: ["navy"],
      looks: [],
      rationale: "",
      provenance: "",
      observations: [
        {
          subjectId: p.id,
          visibleColors: "v".repeat(1000),
          fabricNotes: "f".repeat(1000),
          fitNotes: "n".repeat(1000),
          uncertainty: "u".repeat(1000),
          source: "USER_REPORTED" as const,
        },
      ],
    };
    const result = wardrobeRules(
      {
        ...shoot,
        settings: { ...shoot.settings, sceneDetails: "d".repeat(2000) },
      },
      { ...s, subjects: [s.subjects[0], p, ...s.subjects.slice(2)] },
      old,
    );
    const c = result.looks[1].candidates[0];
    expect(c.comfort).toContain(p.fitComfort);
    expect(c.comfort).toContain(p.mobilityNotes);
    expect(c.color).toBe(p.preferredColors);
    expect(c.suitability).toContain("v".repeat(1000));
  });
});
it("adapts the reviewed three-face lighting guide without inventing measured geometry or source citations", async () => {
  await withShoot(owner, id, (s, shoot) => {
    const l = lightingRules(shoot, s, "STACKED_MONOCHROME", true);
    const key = l.scene.lights[0];
    const face = l.scene.subjects.reduce(
      (p, c) => ({
        ...p,
        x: p.x + c.x / l.scene.subjects.length,
        y: p.y + c.y / l.scene.subjects.length,
      }),
      { x: 0, y: 0 },
    );
    const offset =
      (Math.atan2(Math.abs(key.x - face.x), key.y - face.y) * 180) / Math.PI;
    expect(offset).toBeGreaterThanOrEqual(10);
    expect(offset).toBeLessThanOrEqual(20);
    expect(Math.hypot(key.x - face.x, key.y - face.y)).toBeGreaterThanOrEqual(
      0.9,
    );
    expect(Math.hypot(key.x - face.x, key.y - face.y)).toBeLessThanOrEqual(1.2);
    expect(l.scene.lights[1].x).toBeCloseTo(l.scene.camera.x, 0);
    expect(l.notes.join(" ")).toContain("1.5–2 stops");
    expect(l.notes.join(" ")).toContain("Capture RAW");
    expect(l.notes.join(" ")).toContain("f/7.1");
    expect(l.provenance).toContain("three faces");
    expect(l.provenance).not.toContain("unavailable");
  });
});
