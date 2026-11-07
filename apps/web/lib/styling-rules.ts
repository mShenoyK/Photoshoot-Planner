import type { Shoot } from "@framecraft/shared";
import type { InputState, Subject } from "@framecraft/shared/inputs";
import {
  lightingSchema,
  wardrobeSchema,
  type Lighting,
  type Wardrobe,
} from "@framecraft/shared/styling";
import { InputError } from "./input-repository";
const lightingSource =
  "Reviewed uploaded stacked_family_portrait_lighting_guide.md: Camera settings, Recommended lighting, Black background and Flash workflow. Practical reconstruction, not verified original lighting. The guide illustrates three faces; other group counts are adaptations requiring coverage checks. No ingested document citation is claimed.";
const apparelSource =
  "Reviewed uploaded AI_Apparel_Recommendation_Workflow.md, stages 3–5: editable uncertain observations, individual styling and group coordination. Deterministic manual-profile adaptation; no photo analysis or ingested document citation is claimed.";
export function lightingRules(
  shoot: Shoot,
  state: InputState,
  recipe: Lighting["recipe"],
  fill: boolean,
): Lighting {
  if (
    state.subjects.length &&
    shoot.subjectCount &&
    state.subjects.length !== shoot.subjectCount
  )
    throw new InputError(
      "COUNT_MISMATCH",
      "The stated count and profiles differ. Update them before generating lighting.",
    );
  const kit = state.cameraKit;
  const stacked = recipe === "STACKED_MONOCHROME";
  const natural = shoot.settings.lightMode === "NATURAL";
  const flash = !natural && (kit?.flashCount ?? 0) > 0;
  const mixed = shoot.settings.lightMode === "MIXED";
  if (
    stacked &&
    (shoot.shootType !== "INDOOR" ||
      natural ||
      !flash ||
      !/90.*(octa)|octa.*90/i.test(kit?.modifiers ?? "") ||
      !/grid/i.test(kit?.modifiers ?? ""))
  )
    throw new InputError(
      "RECIPE_EQUIPMENT",
      "Stacked monochrome requires an indoor artificial/mixed-light setup, a flash and a 90 cm gridded octabox. Select the Canon kit or compatible equipment.",
    );
  const people = state.subjects.length
    ? state.subjects
    : Array.from({ length: shoot.subjectCount ?? 1 }, (_, i) => ({
        id: `generic-${i + 1}`,
        label: `Subject ${i + 1}`,
        ageGroup: "UNSPECIFIED",
      }));
  const scene: Lighting["scene"] = {
    units: "meters",
    bounds: { width: 6, height: 5 },
    camera: { x: 3, y: 4.5, heightM: 1.4, directionDeg: 270 },
    subjects: people.map((p, i) => ({
      id: p.id,
      label: p.label || `Subject ${i + 1}`,
      x:
        3 +
        (i - (people.length - 1) / 2) *
          Math.min(stacked ? 0.16 : 0.4, 4 / people.length),
      y: 2.1,
      heightM:
        (["BABY", "TODDLER", "CHILD"].includes(p.ageGroup) ? 1 : 1.5) -
        (stacked ? (i % 2) * 0.15 : 0),
    })),
    lights: [
      {
        id: "key",
        kind: flash
          ? "FLASH"
          : shoot.shootType === "INDOOR"
            ? "WINDOW"
            : "SHADE",
        purpose: "KEY",
        modifier: flash
          ? kit!.modifiers || "Available flash; modifier unconfirmed"
          : "Available light; no reflector assumed",
        x: stacked ? 2.72 : 1.5,
        y: stacked ? 3.15 : 2.8,
        heightM: 2.1,
        directionDeg: stacked ? 285 : 325,
      },
    ],
    backdrop: { kind: stacked ? "BLACK" : "SCENE", y: 0.6 },
  };
  if (fill && flash && kit!.flashCount > 1)
    scene.lights.push({
      id: "fill",
      kind: "FLASH",
      purpose: "FILL",
      modifier: stacked
        ? "Weak near-axis fill; diffusion required, confirm available"
        : "Second flash, weak fill; modifier not assumed",
      x: stacked ? 3.25 : 4.5,
      y: stacked ? 3.7 : 3.4,
      heightM: 1.6,
      directionDeg: stacked ? 261 : 225,
    });
  const notes = [
    ...(!state.subjects.length
      ? [
          "Generic subject markers: profiles are not confirmed. Add manual profiles for age-aware planning; no photos are required.",
        ]
      : []),
    "Illustrative geometry and face heights only, not participant measurements. Adjust supported seat levels to the actual people. Measure room, ceiling and stand clearance; secure stands and keep cables out of paths.",
    "Keep faces near one focus plane; check every face at 100%, depth of field and key coverage. Do not physically stack people or place weight on another person; use stable independent seats and guardian support.",
    "These are unmetered starting points, not exposure guarantees. Adjust ISO, aperture and flash power after test frames; verify shutter sync for your camera/trigger.",
    "Confirm the actual lens range before selecting a focal length; step back for groups rather than crowding faces at wide angle.",
  ];
  if (stacked)
    notes.push(
      "Arrange a vertical composition with supported seats and face levels; use a dark backdrop, prevent key spill and inspect monochrome tonal separation. Never suspend or balance a baby; a guardian must provide support.",
      "Guide starting geometry: key 10–20° camera-left, about 0.9–1.2 m from the nearest face, above the top face and tilted down 25–40°. These are approximate starting ranges, not measured requirements; adjust to cover every face, especially the lowest face under the grid.",
      "Start with the second flash OFF. Only if needed, use a near-camera reflector if available or diffused near-axis fill about 1.5–2 stops below the key. Confirm a diffuser is available before using the second flash; avoid bare direct fill and competing catchlights.",
      "Capture RAW. Take a flashes-OFF test frame and suppress ambient until nearly black; then adjust the key for detailed skin highlights. Do not underexpose faces to darken the background. Separate subjects from backdrop about 1.5–1.8 m if space permits and control spill with the grid or available flags.",
      "If flash power is limited, try f/7.1 only after checking depth of field. Use eye detection or a single point near the middle face plane and magnify every face to verify sharpness. Adjust key distance/tilt before adding fill for an unevenly lit lower face.",
      "For monochrome processing, retain skin midtones and hair/clothing texture; balance faces with modest local adjustments. Avoid universal red-channel or aggressive child-face texture adjustments.",
    );
  if (!flash)
    notes.push(
      natural
        ? shoot.shootType === "INDOOR"
          ? "Place the group near a window; diffuse harsh sunlight if safe. Turn off conflicting room lights and inspect catchlights."
          : "Start in open shade facing open sky; check sun direction on location. For backlight, expose for faces and inspect flare; use a reflector only if available."
        : "No flash is recorded. This is an available-light fallback, not an artificial-light setup. Add equipment for a flash recipe.",
    );
  if (mixed)
    notes.push(
      "Meter ambient first, then add flash gradually. Compare ambient-only and flash frames; match color temperature with gels if available and test white balance.",
    );
  if (fill && (!flash || kit!.flashCount < 2))
    notes.push(
      "Optional flash fill was omitted: a second flash is not recorded.",
    );
  return lightingSchema.parse({
    recipe,
    title: stacked
      ? "Stacked monochrome family portrait"
      : `${shoot.settings.lightMode.toLowerCase()} portrait lighting`,
    scene,
    settings: {
      mode: "M",
      iso: flash ? "100" : "400–1600; adjust to ambient",
      aperture:
        people.length > 1 || stacked
          ? "f/8; verify all faces"
          : "f/4–f/5.6; verify lens capability",
      shutter: flash
        ? "1/160 s; verify sync"
        : "1/250 s or faster for movement",
      focalLength:
        stacked && /24.*105/.test(kit?.lens ?? "")
          ? "85–105 mm if space permits"
          : "Use an available portrait focal length; confirm lens and framing",
      focus:
        "Focus on a face near the group plane; inspect all faces, especially children",
      whiteBalance: mixed
        ? "Custom neutral reference for mixed sources"
        : "Set from a neutral reference; avoid automatic shifts between frames",
    },
    notes,
    provenance: stacked
      ? lightingSource
      : "Generated context-aware lighting guidance; exposure and geometry require on-location verification.",
  });
}
const tokens = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
function candidates(
  p: Subject,
  colors: string[],
  shoot: Shoot,
  observation: Wardrobe["observations"][number] | undefined,
): Wardrobe["looks"][number]["candidates"] {
  const avoid = tokens(p.avoidedColors);
  const preferred = tokens(p.preferredColors).filter(
    (c) => !avoid.some((a) => c.includes(a) || a.includes(c)),
  );
  const safe = [...new Set([...preferred, ...colors])].filter(
    (c) => !avoid.some((a) => c.includes(a) || a.includes(c)),
  );
  if (!safe.length)
    throw new InputError(
      "PALETTE_CONFLICT",
      `No available colors remain for ${p.label || "this subject"}. Adjust avoided colors or hero palette.`,
    );
  return ["Relaxed layers", "Occasion separates", "Textured tonal look"].map(
    (name, i) => ({
      id: `${p.id}-${i}`,
      name,
      color: safe[i % safe.length],
      garments: [
        i === 0
          ? "Soft breathable top and comfortable trousers or skirt"
          : i === 1
            ? "Occasion-appropriate shirt, tunic or top with preferred bottoms"
            : "Matte textured layer over a comfortable base",
        `Color direction: ${safe[i % safe.length]}; choose your own silhouette`,
      ],
      accessories: [
        "Optional simple accessory; omit snagging items for children",
        "Stable footwear suited to terrain and mobility",
      ],
      rationale: `Coordinates color weight without identical outfits. Use solid or broad, low-density patterns so faces remain readable. ${preferred.length ? "Stated color preferences take priority." : "Palette is a suggestion; no appearance or personality was inferred."}`,
      suitability: `${shoot.settings.sceneCategory}: ${shoot.settings.sceneDetails || "verify backdrop contrast on location"}. ${shoot.settings.lightMode === "NATURAL" ? "Breathable layers for shade; check wind, heat and weather." : "Matte fabric reduces flash glare; check sheen and white clipping under the actual light."} Occasion: ${shoot.settings.occasion || "confirm formality"}. ${observation?.visibleColors ? `Reported garment colors: ${observation.visibleColors}; uncertain, verify under neutral light before using. ${observation.uncertainty}` : ""}`,
      comfort: `Confirm size ${p.clothingSize || "with participant"}; never infer measurements. ${p.fitComfort || "Allow free movement and seated comfort."} ${p.mobilityNotes || "Ask about footwear, sensory needs and accessible changing space."} ${observation?.fitNotes ? `User fit note: ${observation.fitNotes}` : ""}`,
      alternatives: `${p.stylePreferences ? `Respect stated preferences: ${p.stylePreferences}. ` : "Confirm cultural coverage and personal preferences. "}Use existing clothes or low-cost separates${p.budget !== undefined ? ` within the stated ${p.currency} ${p.budget} budget (no live prices checked)` : "; confirm budget"}. Add/remove layers for weather. ${observation?.fabricNotes ? `Review user fabric note: ${observation.fabricNotes}` : ""}`,
    }),
  );
}
export function wardrobeRules(
  shoot: Shoot,
  state: InputState,
  old?: Wardrobe,
  heroSubjectId?: string,
): Wardrobe {
  const subjects = state.subjects;
  if (!subjects.length)
    throw new InputError(
      "SUBJECTS_REQUIRED",
      "Add manual subject profiles first. Photos are optional.",
    );
  if (shoot.subjectCount && shoot.subjectCount !== subjects.length)
    throw new InputError(
      "COUNT_MISMATCH",
      "The stated count and subject profiles differ. Update the shoot or profiles first.",
    );
  const hero = heroSubjectId;
  if (hero && !subjects.some((p) => p.id === hero))
    throw new InputError(
      "NOT_FOUND",
      "Hero subject not found in this shoot.",
      404,
    );
  const retained =
    old?.looks.filter(
      (l) => l.locked && subjects.some((p) => p.id === l.subjectId),
    ) ?? [];
  const heroLook = old?.looks.find((l) => l.subjectId === hero);
  if (heroLook && !retained.some((l) => l.subjectId === heroLook.subjectId))
    retained.push(heroLook);
  for (const l of retained) {
    const p = subjects.find((p) => p.id === l.subjectId)!;
    const color = l.candidates.find((c) => c.id === l.selectedId)!.color;
    if (
      tokens(p.avoidedColors).some(
        (a) => color.includes(a) || a.includes(color),
      )
    )
      throw new InputError(
        "LOCK_CONFLICT",
        `Unlock ${p.label || "subject"} or clear the hero before rebalancing: its selected color conflicts with current avoided colors.`,
        409,
      );
  }
  const anchorColors = [...retained, ...(heroLook ? [heroLook] : [])].map(
    (l) => l.candidates.find((c) => c.id === l.selectedId)!.color,
  );
  const heroPreference =
    subjects.find((p) => p.id === hero)?.preferredColors ?? "";
  const palette = [
    ...new Set([
      ...anchorColors,
      ...tokens(heroPreference),
      ...(shoot.settings.sceneCategory === "GARDEN" ||
      shoot.settings.sceneCategory === "FOREST"
        ? ["cream", "terracotta", "navy"]
        : ["slate", "cream", "muted blue"]),
    ]),
  ].slice(0, 20);
  const observations =
    old?.observations.filter((o) =>
      subjects.some((p) => p.id === o.subjectId),
    ) ?? [];
  return wardrobeSchema.parse({
    palette,
    heroSubjectId: hero,
    observations,
    looks: subjects.map(
      (p, index) =>
        retained.find((l) => l.subjectId === p.id) ?? {
          subjectId: p.id,
          label: p.label || "Subject",
          candidates: candidates(
            p,
            [
              ...palette.slice(index % palette.length),
              ...palette.slice(0, index % palette.length),
            ],
            shoot,
            observations.find((o) => o.subjectId === p.id),
          ),
          selectedId: `${p.id}-0`,
          locked: false,
        },
    ),
    rationale:
      "Balance a limited palette, similar formality and low print density. Locked looks remain unchanged; unlocked choices adapt around the hero and locked colors. Check background separation in a test frame; ask every participant about comfort and coverage. User-reported observations are uncertain, never automatic appearance assessments.",
    provenance: apparelSource,
  });
}
