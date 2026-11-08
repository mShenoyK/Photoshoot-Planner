import { z } from "zod";
export const categories = [
  "BABY_BOY",
  "BABY_GIRL",
  "TODDLER_BOY",
  "TODDLER_GIRL",
  "KID_BOY",
  "KID_GIRL",
  "MAN",
  "WOMAN",
  "COUPLE",
  "FAMILY_MIXED",
  "GROUP_MIXED",
  "UNSPECIFIED",
] as const;
export const shootSchema = z
  .object({
    workflowKind: z.enum(["POSES", "LIGHTING", "WARDROBE"]).optional(),
    name: z.string().trim().min(3).max(120),
    description: z.string().max(2000).default(""),
    shootType: z.enum(["INDOOR", "OUTDOOR"]),
    portraitCategory: z.enum([
      "PORTRAIT_INDIVIDUAL",
      "PORTRAIT_GROUP",
      "PORTFOLIO",
    ]),
    subjectCategory: z.enum(categories),
    subjectCount: z.number().int().min(1).max(20).optional(),
    date: z
      .string()
      .refine(
        (v) => v === "" || z.string().date().safeParse(v).success,
        "Use a date",
      )
      .default(""),
    time: z
      .string()
      .refine(
        (v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
        "Use a time",
      )
      .default(""),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA time zone"),
    durationMinutes: z.number().int().min(15).max(480).optional(),
    settings: z.object({
      lightMode: z.enum(["NATURAL", "ARTIFICIAL", "MIXED"]),
      sceneCategory: z.string().trim().min(1).max(120),
      sceneDetails: z.string().max(2000).default(""),
      occasion: z.string().max(200).default(""),
      creativeTags: z.array(z.string().max(60)).max(12).default([]),
    }),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      s.portraitCategory === "PORTRAIT_GROUP" &&
      s.subjectCount !== undefined &&
      s.subjectCount < 2
    )
      c.addIssue({
        code: "custom",
        path: ["subjectCount"],
        message: "Groups need 2–20 people, or leave count unspecified.",
      });
    if (s.portraitCategory === "PORTRAIT_INDIVIDUAL" && s.subjectCount !== 1)
      c.addIssue({
        code: "custom",
        path: ["subjectCount"],
        message: "Individual portraits need one person.",
      });
  });
export type ShootInput = z.infer<typeof shootSchema>;
export type Shoot = ShootInput & {
  id: string;
  ownerId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export const defaults: ShootInput = {
  name: "Untitled shoot",
  description: "",
  shootType: "OUTDOOR",
  portraitCategory: "PORTRAIT_INDIVIDUAL",
  subjectCategory: "UNSPECIFIED",
  subjectCount: 1,
  date: "",
  time: "",
  timezone: "UTC",
  settings: {
    lightMode: "NATURAL",
    sceneCategory: "GARDEN",
    sceneDetails: "",
    occasion: "",
    creativeTags: [],
  },
};
