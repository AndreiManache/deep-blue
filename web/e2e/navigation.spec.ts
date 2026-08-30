import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin, uniqueUsername } from "./helpers";

test.beforeEach(async ({ page }) => {
  await registerAndLogin(page, uniqueUsername("e2e_nav"));
});

// Every sub-page below goes through the same BackHeader (see
// web/src/components/BackHeader.tsx) — asserting the back arrow returns to
// the orb is really asserting the whole onNavigate/setView wiring in App.tsx
// didn't regress for that menu item.
async function openMenuItem(page: Page, label: string) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

for (const [menuLabel, heading] of [
  ["Dashboard", "Today"],
  ["Profile", "Profile"],
  ["Diagnostics", "Diagnostics"],
  ["Send feedback", "Feedback"],
  ["My feedback", "My feedback"],
] as const) {
  test(`${menuLabel} opens, shows ${heading}, and Back returns home`, async ({ page }) => {
    await openMenuItem(page, menuLabel);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();

    // exact:true matters here — "Back" is a substring of "feedBACK", so a
    // loose match on the Send-feedback page also hits its submit button.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByText("Tap to talk")).toBeVisible();
  });
}

test("no console errors while visiting every menu page in one session", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  for (const label of ["Dashboard", "Profile", "Diagnostics", "Send feedback", "My feedback"]) {
    await openMenuItem(page, label);
    // exact:true matters here — "Back" is a substring of "feedBACK", so a
    // loose match on the Send-feedback page also hits its submit button.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByText("Tap to talk")).toBeVisible();
  }

  expect(errors, `unexpected console errors: ${errors.join("\n")}`).toEqual([]);
});
