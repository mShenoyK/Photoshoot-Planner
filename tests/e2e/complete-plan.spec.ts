import { test, expect } from "@playwright/test";
import { defaults } from "../../packages/shared/src/shoot";
import { blankSubject } from "../../packages/shared/src/inputs";
for (const width of [375, 1440])
  test(`complete outdoor no-photo plan at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const post = async (route: string, data: unknown) => {
      const response = await page.request.post(`/api/v1/${route}`, {
        headers: { origin: "http://localhost:3000" },
        data,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).data;
    };
    await post("auth/register", {
      email: `complete-${width}-${Date.now()}@example.com`,
      password: "browser-password-123",
    });
    const shoot = await post("shoots", {
      ...defaults,
      name: "Garden birthday",
      shootType: "OUTDOOR",
      subjectCount: 1,
      settings: {
        ...defaults.settings,
        lightMode: "NATURAL",
        occasion: "Birthday",
        sceneDetails: "Shaded garden beside a pale wall",
      },
    });
    await post(`shoots/${shoot.id}/subjects`, {
      ...blankSubject,
      label: "Guest",
      ageGroup: "ADULT",
      fitComfort: "Soft breathable layers",
    });
    await page.goto(`/shoots/${shoot.id}/plan`);
    await page
      .getByRole("button", {
        name: "Generate complete shoot plan",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Wardrobe looks", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Lighting setup", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".complete-diagram svg")).toHaveCount(2);
    await expect(
      page.locator(".outfit-reference .recommendation-visual"),
    ).toHaveCount(3);
    await expect(page.locator(".pose-card .recommendation-visual")).toHaveCount(
      6,
    );
    await expect(
      page.getByText(/This bundle used 0 reviewed references/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `/tmp/framecraft-complete-outdoor-${width}.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Wardrobe looks", exact: true }),
    ).toBeVisible();
  });
