import { test, expect } from "@playwright/test";
import { defaults } from "../../packages/shared/src/shoot";
import { blankSubject } from "../../packages/shared/src/inputs";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
for (const width of [375, 768, 1280, 1440])
  test(`original illustration and private ZIP at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const post = async (route: string, data: unknown) => {
      const r = await page.request.post(`/api/v1/${route}`, {
        headers: { origin: "http://localhost:3000" },
        data,
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).data;
    };
    await post("auth/register", {
      email: `artifacts-${width}-${Date.now()}@example.com`,
      password: "browser-password-123",
    });
    const shoot = await post("shoots", {
      ...defaults,
      name: "Original family export",
      portraitCategory: "PORTRAIT_GROUP",
      subjectCount: 4,
    });
    for (let i = 0; i < 4; i++)
      await post(`shoots/${shoot.id}/subjects`, {
        ...blankSubject,
        label: `Person ${i + 1}`,
        ageGroup: i < 2 ? "ADULT" : "CHILD",
      });
    const job = await post(`shoots/${shoot.id}/plans`, {
      poseCount: 3,
      useKnowledgeBase: false,
      idempotencyKey: crypto.randomUUID(),
    });
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/v1/jobs/${job.id}`);
        return (await r.json()).data.status;
      })
      .toBe("SUCCEEDED");
    await post(`shoots/${shoot.id}/styling`, {
      action: "LIGHTING",
      recipe: "CONTEXT",
      baseRevision: 0,
    });
    await post(`shoots/${shoot.id}/styling`, {
      action: "WARDROBE",
      baseRevision: 1,
    });
    await page.goto(`/shoots/${shoot.id}/files`);
    await expect(
      page.getByText("No generated files yet.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Generate original schematic", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Succeeded");
    await expect(
      page.getByRole("img", { name: /Original mock support/ }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole("img", { name: /Original mock support/ })
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const imageDownload = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download Illustration", exact: true })
      .click();
    const svg = await readFile((await (await imageDownload).path())!, "utf8");
    expect(svg.match(/data-subject=/g)).toHaveLength(4);
    expect(svg).not.toContain("<image");
    await page.getByLabel("Styling revision for export").selectOption("2");
    await page
      .getByRole("button", { name: "Create export", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Download Zip", exact: true }),
    ).toBeVisible();
    const zipDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download Zip", exact: true }).click();
    const files = unzipSync(
      await readFile((await (await zipDownload).path())!),
    );
    expect(files["manifest.json"]).toBeDefined();
    expect(files["shoot-plan.pdf"]).toBeDefined();
    expect(Object.keys(files).some((k) => /\.(jpg|webp)$/i.test(k))).toBe(
      false,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-artifacts-${width}.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Download Zip", exact: true }),
    ).toBeVisible();
  });
