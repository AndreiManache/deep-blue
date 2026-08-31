import { expect, test } from "@playwright/test";
import { registerAndLogin, TEST_PASSWORD, uniqueUsername } from "./helpers";

test("an unauthenticated visit shows the login screen, not the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  // The orb (and everything else gated behind a session) must not be
  // reachable without a token.
  await expect(page.getByText("Tap to talk")).not.toBeVisible();
});

test("register -> home -> log out -> log back in", async ({ page }) => {
  const username = uniqueUsername("e2e_auth");
  await registerAndLogin(page, username);

  // Logged out cleanly returns to the login screen, not a blank/broken state.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  // The same account can log back in — proves the account was actually
  // persisted server-side, not just an optimistic client-side state flip.
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Tap to talk")).toBeVisible();
});

test("registering an already-taken username shows an error, not a crash", async ({ page }) => {
  const username = uniqueUsername("e2e_dup");
  await registerAndLogin(page, username);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();

  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("That username is already taken.")).toBeVisible();
});
