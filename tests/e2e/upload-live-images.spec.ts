import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { blankSubject } from "../../packages/shared/src/inputs";
for (const width of [375, 1440])
  test(`file selection enables actionable private intake at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const headers = { origin: "http://localhost:3000" };
    const post = async (route: string, data: unknown) => {
      const response = await page.request.post(`/api/v1/${route}`, {
        headers,
        data,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).data;
    };
    await post("auth/register", {
      email: `intake-fix-${width}-${Date.now()}@example.com`,
      password: "browser-password-123",
    });
    const workflow = await post("workflows", {
      kind: "WARDROBE",
      name: "Intake regression",
      environment: "INDOOR",
      scene: "Window",
      occasion: "Portrait",
      lightMode: "NATURAL",
    });
    await post(`shoots/${workflow.id}/subjects`, {
      ...blankSubject,
      label: "Guest",
      ageGroup: "ADULT",
    });
    await page.goto(`/tools/wardrobe/${workflow.id}`);
    await page
      .getByRole("button", { name: "Upload reference images", exact: true })
      .click();
    const upload = page.getByRole("button", {
      name: "Upload privately",
      exact: true,
    });
    await expect(upload).toBeDisabled();
    const bytes = await sharp({
      create: { width: 512, height: 768, channels: 3, background: "#6688aa" },
    })
      .jpeg()
      .toBuffer();
    await page
      .getByLabel("Choose image (JPG, PNG or WebP; default limit 15 MB)")
      .setInputFiles({
        name: "synthetic-reference.jpg",
        mimeType: "image/jpeg",
        buffer: bytes,
      });
    await expect(upload).toBeEnabled();
    let uploadRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/upload-intents")
      )
        uploadRequests++;
    });
    await upload.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Select every identifiable person/ }),
    ).toBeVisible();
    expect(uploadRequests).toBe(0);
    await page
      .getByRole("checkbox", { name: /Guest · consent not recorded/ })
      .check();
    await upload.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Record photo consent for Guest/ }),
    ).toBeVisible();
    expect(uploadRequests).toBe(0);
    const permission = page.locator(".intake-permission");
    await permission
      .getByText("Photo consent · not recorded", { exact: true })
      .click();
    await permission.getByLabel("I confirm that the subject").check();
    await permission.getByLabel("The subject or guardian agreed").check();
    await permission
      .getByRole("button", { name: "Record consent", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name: /Guest · consent granted/ }),
    ).toBeChecked();
    await upload.click();
    await expect(
      page.getByText("Photo saved privately.", { exact: true }),
    ).toBeVisible();
    expect(uploadRequests).toBe(1);
    await expect(page).toHaveURL(`/tools/wardrobe/${workflow.id}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `/tmp/framecraft-intake-fixed-${width}.png`,
      fullPage: true,
    });
    // Inspiration images can explicitly declare that no identifiable people are present.
    await page
      .getByRole("checkbox", { name: /Guest · consent granted/ })
      .uncheck();
    await page
      .getByLabel("I confirm this reference contains no identifiable people.", {
        exact: true,
      })
      .check();
    await expect(
      page.getByLabel("Reference type", { exact: true }),
    ).toHaveValue("WARDROBE_REFERENCE");
    await upload.click();
    await expect(
      page.getByRole("heading", {
        name: "synthetic-reference.jpg",
        exact: true,
      }),
    ).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });

test("recommendations expose live-image configuration errors without fake visual substitutes", async ({
  page,
}) => {
  const headers = { origin: "http://localhost:3000" };
  const post = async (route: string, data: unknown) => {
    const response = await page.request.post(`/api/v1/${route}`, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).data;
  };
  await post("auth/register", {
    email: `live-gate-${Date.now()}@example.com`,
    password: "browser-password-123",
  });
  const workflow = await post("workflows", {
    kind: "WARDROBE",
    name: "Live image gate",
    environment: "INDOOR",
    scene: "Studio",
    occasion: "Portrait",
    lightMode: "NATURAL",
  });
  await post(`shoots/${workflow.id}/subjects`, {
    ...blankSubject,
    label: "Guest",
    ageGroup: "ADULT",
  });
  await page.goto(`/tools/wardrobe/${workflow.id}`);
  await page
    .getByRole("button", { name: "Generate wardrobe", exact: true })
    .click();
  await expect(page.locator(".recommendation-visual")).toHaveCount(3);
  await expect(
    page.getByText(
      "Live image generation is not configured. No dummy image is shown.",
      { exact: true },
    ),
  ).toHaveCount(3);
  await expect(page.locator(".outfit-visual, .pose-schematic")).toHaveCount(0);
  const generated = page.locator(".recommendation-visual");
  await expect(generated.locator("img, svg")).toHaveCount(0);
});
