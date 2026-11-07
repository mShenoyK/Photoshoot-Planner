import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { defaults } from "../../packages/shared/src/shoot";
import { blankSubject } from "../../packages/shared/src/inputs";
for (const width of [375, 1440])
  test(`reference-led family planning and refreshed design at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Your vision. Beautifully planned." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page
      .getByRole("button", { name: "New here? Create account" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Already have an account? Sign in" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/framecraft-refresh-home-${width}.png`,
      fullPage: true,
    });
    const headers = { origin: "http://localhost:3000" };
    const post = async (route: string, data: unknown) => {
      const r = await page.request.post(`/api/v1/${route}`, { headers, data });
      expect(r.ok(), await r.text()).toBeTruthy();
      return (await r.json()).data;
    };
    await post("auth/register", {
      email: `reference-design-${width}-${Date.now()}@example.com`,
      password: "browser-password-123",
    });
    const shoot = await post("shoots", {
      ...defaults,
      name: "Reference-led family",
      portraitCategory: "PORTRAIT_GROUP",
      subjectCount: 4,
    });
    let primary = "";
    for (let i = 0; i < 4; i++) {
      const p = await post(`shoots/${shoot.id}/subjects`, {
        ...blankSubject,
        label: `Person ${i + 1}`,
        ageGroup: i < 2 ? "ADULT" : "CHILD",
      });
      if (i === 0) primary = p.id;
    }
    await post(`shoots/${shoot.id}/subjects/${primary}/consents`, {
      status: "GRANTED",
      acknowledged: true,
      confirmedAuthority: true,
      allowAnalysis: true,
    });
    const image = await sharp({
      create: { width: 512, height: 768, channels: 3, background: "#637eac" },
    })
      .jpeg()
      .toBuffer();
    const intent = await post(`shoots/${shoot.id}/upload-intents`, {
      fileName: "synthetic-reference.jpg",
      mime: "image/jpeg",
      bytes: image.length,
      kind: "SUBJECT_PHOTO",
      subjectIds: [primary],
    });
    const uploaded = await page.request.put(intent.uploadUrl, {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        Authorization: `Bearer ${intent.uploadToken}`,
      },
      data: image,
    });
    expect(uploaded.ok()).toBeTruthy();
    await post(`shoots/${shoot.id}/uploads/${intent.id}/complete`, {});
    await page.goto(`/shoots/${shoot.id}/plan`);
    await expect(
      page.getByRole("heading", { name: "Your reference images." }),
    ).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Analyze reference", exact: true })
      .click();
    await page
      .getByLabel("Visible proportions / body-shape impression")
      .fill(
        "Participant confirmed relaxed shoulder room; image proportions are uncertain.",
      );
    await page
      .getByLabel("Scene observations")
      .fill("Our garden reference has a quiet backdrop.");
    await page
      .getByLabel("Light observations")
      .fill("Camera-right soft light; confirm from test frames.");
    await page.getByLabel("Key light side").selectOption("RIGHT");
    await page
      .getByRole("button", { name: "Confirm and use reference", exact: true })
      .click();
    await expect(page.getByText(/Reviewed and included/)).toBeVisible();
    await page
      .getByRole("button", { name: "Generate plan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Posing guide", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-pose-subject]")).toHaveCount(24);
    await expect(
      page.getByText(/Reviewed photo context: Our garden/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-refresh-plan-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Lighting Lab", exact: true }).click();
    await page
      .getByRole("button", { name: "Generate lighting", exact: true })
      .click();
    await expect(page.getByLabel("Key horizontal position (m)")).toHaveValue(
      "4.5",
    );
    await page.getByLabel("Key height (m)").fill("2.4");
    await page.getByRole("button", { name: "Update lighting diagram" }).click();
    await expect(page.getByLabel("Key height (m)")).toHaveValue("2.4");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-refresh-lighting-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Wardrobe Stylist", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generate wardrobe", exact: true })
      .click();
    const person = page.getByRole("region", { name: "Looks for Person 1" });
    await expect(
      person.getByText(/Participant confirmed relaxed shoulder room/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Coordinated palette" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-refresh-wardrobe-${width}.png`,
      fullPage: true,
    });
  });
test("refreshed dark theme keeps mobile forms readable and keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create account" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page.getByLabel("Email address").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  const colors = await page
    .getByRole("button", { name: "Create account", exact: true })
    .evaluate((el) => ({
      fg: getComputedStyle(el).color,
      bg: getComputedStyle(el).backgroundColor,
    }));
  const luminance = (value: string) => {
    const channels = value
      .match(/\d+/g)!
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        const c = n / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(colors.fg),
    b = luminance(colors.bg);
  expect(
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "/tmp/framecraft-refresh-dark-375.png",
    fullPage: true,
  });
});
