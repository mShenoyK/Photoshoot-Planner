import { test, expect } from "@playwright/test";
import { defaults } from "../../packages/shared/src/shoot";
import { blankSubject } from "../../packages/shared/src/inputs";
for (const width of [375, 1440])
  test(`four-person no-photo lighting and wardrobe at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const reg = await page.request.post("/api/v1/auth/register", {
      headers: { origin: "http://localhost:3000" },
      data: {
        email: `styling-${width}-${Date.now()}@example.com`,
        password: "browser-password-123",
      },
    });
    expect(reg.ok()).toBeTruthy();
    const post = async (route: string, data: unknown) => {
      const r = await page.request.post(`/api/v1/${route}`, {
        headers: { origin: "http://localhost:3000" },
        data,
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).data;
    };
    const shoot = await post("shoots", {
      ...defaults,
      name: "Family lighting and wardrobe",
      shootType: "INDOOR",
      portraitCategory: "PORTRAIT_GROUP",
      subjectCategory: "FAMILY_MIXED",
      subjectCount: 4,
      settings: { ...defaults.settings, lightMode: "ARTIFICIAL" },
    });
    for (let i = 0; i < 4; i++)
      await post(`shoots/${shoot.id}/subjects`, {
        ...blankSubject,
        label: `Person ${i + 1}`,
        ageGroup: i < 2 ? "ADULT" : "CHILD",
        fitComfort: i === 3 ? "Soft seams, seated comfort" : "",
      });
    const kit = await post("equipment/canon-preset", {});
    const select = await page.request.patch(
      `/api/v1/shoots/${shoot.id}/equipment`,
      { headers: { origin: "http://localhost:3000" }, data: { kitId: kit.id } },
    );
    expect(select.ok(), await select.text()).toBeTruthy();
    await page.goto(`/shoots/${shoot.id}/lighting`);
    await page.getByLabel("Lighting recipe").selectOption("STACKED_MONOCHROME");
    await page.getByLabel("Optional weak").check();
    await page
      .getByRole("button", { name: "Generate lighting", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Stacked monochrome family portrait" }),
    ).toBeVisible();
    await expect(page.locator("svg [data-subject]")).toHaveCount(8);
    await expect(
      page.getByText("85–105 mm if space permits", { exact: true }),
    ).toBeVisible();
    await page.getByText("Edit diagram coordinates", { exact: true }).click();
    const sceneBox = page.getByLabel("Scene coordinates (JSON)");
    const scene = JSON.parse(await sceneBox.inputValue());
    scene.camera.x = 3.5;
    await sceneBox.fill(JSON.stringify(scene));
    await page
      .getByRole("button", { name: "Save diagram", exact: true })
      .click();
    await expect(page.getByLabel("Styling version")).toHaveValue("2");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download top SVG" }).click();
    expect((await download).suggestedFilename()).toBe("lighting-top.svg");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-lighting-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Wardrobe Stylist", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generate wardrobe", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Coordinated palette" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(12);
    await page
      .getByRole("button", {
        name: "Choose Occasion separates for Person 1",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Lock Person 1", exact: true })
      .click();
    await page
      .getByLabel("Hero outfit anchor")
      .selectOption({ label: "Person 1" });
    await page
      .getByRole("button", { name: "Rebalance unlocked looks", exact: true })
      .click();
    const person1 = page.getByRole("region", { name: "Looks for Person 1" });
    await expect(
      person1.getByText("Outfit locked", { exact: true }),
    ).toBeVisible();
    await expect(
      person1.getByRole("button", {
        name: "Choose Relaxed layers for Person 1",
      }),
    ).toBeDisabled();
    const person2 = page.getByRole("region", { name: "Looks for Person 2" });
    await person2
      .getByText("Editable observations and comfort notes", { exact: true })
      .click();
    await person2
      .getByLabel("Fit and comfort notes")
      .fill("Soft cotton for sensory comfort");
    await person2.getByRole("button", { name: "Save observations" }).click();
    await page
      .getByRole("button", { name: "Rebalance unlocked looks", exact: true })
      .click();
    await expect(
      person2
        .getByText(/User fit note: Soft cotton for sensory comfort/)
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-wardrobe-${width}.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      person1.getByText("Outfit locked", { exact: true }),
    ).toBeVisible();
    const inputs = await page.request.get(`/api/v1/shoots/${shoot.id}/inputs`);
    expect((await inputs.json()).data.media).toHaveLength(0);
  });
