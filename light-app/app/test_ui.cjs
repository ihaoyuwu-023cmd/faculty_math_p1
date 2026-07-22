"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const APP_URL = (process.env.APP_URL || "http://127.0.0.1:8765").replace(/\/$/, "");
const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const systemCandidates = [
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ];
  const systemBrowser = systemCandidates.find((candidate) => fs.existsSync(candidate));
  if (systemBrowser) return systemBrowser;
  const browserRoot = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!fs.existsSync(browserRoot)) return undefined;
  const installations = fs.readdirSync(browserRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const installation of installations) {
    const executable = path.join(browserRoot, installation, "chrome-win64", "chrome.exe");
    if (fs.existsSync(executable)) return executable;
  }
  return undefined;
}

function attachDiagnostics(page, diagnostics) {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText || "";
    if (errorText.includes("ERR_ABORTED")) return;
    diagnostics.failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== new URL(APP_URL).origin) diagnostics.externalRequests.push(request.url());
  });
}

async function waitForApp(page) {
  await page.waitForFunction(() => document.getElementById("connection-label")?.textContent === "本地服务已连接");
  await page.waitForSelector("#view-root .page:not(:has(.loading-state))", { state: "visible" });
}

async function waitForRoute(page, hashPrefix, readySelector) {
  await page.waitForFunction((prefix) => window.location.hash.startsWith(prefix), hashPrefix);
  await page.waitForSelector(readySelector, { state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#view-root .loading-state"));
}

async function auditLayout(page, label) {
  const report = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const overflowSelectors = [
      ".page-heading",
      ".metric",
      ".field",
      ".toolbar-actions",
      ".nav-item",
      ".bottom-nav a",
      ".button",
      ".icon-button",
      ".school-chip"
    ];
    const overflow = [...document.querySelectorAll(overflowSelectors.join(","))]
      .filter(visible)
      .filter((element) => element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({
        selector: element.className || element.tagName,
        text: (element.textContent || "").trim().slice(0, 80),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }));
    const viewportWidth = document.documentElement.clientWidth;
    const fixedOutsideViewport = [...document.querySelectorAll(".topbar, .sidebar, .bottom-nav, .drawer.is-open")]
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left < -1 || rect.right > viewportWidth + 1)
      .map(({ element, rect }) => ({
        selector: element.className,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        viewportWidth
      }));
    return {
      viewportWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      overflow,
      fixedOutsideViewport,
      unresolvedIconCount: [...document.querySelectorAll("i[data-lucide]")].filter(visible).length,
      visibleTopbar: visible(document.querySelector(".topbar")),
      visibleSidebar: visible(document.querySelector(".sidebar")),
      visibleBottomNav: visible(document.querySelector(".bottom-nav"))
    };
  });
  assert.ok(report.documentScrollWidth <= report.viewportWidth + 1, `${label}: document has horizontal overflow: ${JSON.stringify(report)}`);
  assert.deepEqual(report.overflow, [], `${label}: controls contain clipped text: ${JSON.stringify(report.overflow)}`);
  assert.deepEqual(report.fixedOutsideViewport, [], `${label}: fixed UI falls outside viewport: ${JSON.stringify(report.fixedOutsideViewport)}`);
  assert.equal(report.unresolvedIconCount, 0, `${label}: unresolved Lucide icons remain`);
  assert.equal(report.visibleTopbar, true, `${label}: top bar is not visible`);
  return report;
}

async function capture(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage, animations: "disabled" });
}

async function verifyImeLiveSearch(page, {
  label,
  inputSelector,
  endpoint,
  intermediateValue,
  finalValue,
  readySelector,
  verifyResults
}) {
  const requestQueries = [];
  const recordSearchRequest = (request) => {
    const url = new URL(request.url());
    if (url.pathname === endpoint) requestQueries.push(url.searchParams.get("q"));
  };
  page.on("request", recordSearchRequest);

  try {
    const searchInput = page.locator(inputSelector);
    const composingInput = await searchInput.elementHandle();
    assert.ok(composingInput, `${label}: search input is missing`);
    await searchInput.focus();
    await searchInput.evaluate((input, value) => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = value;
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertCompositionText",
        isComposing: true
      }));
      input.closest("form")?.requestSubmit();
    }, intermediateValue);

    await page.waitForTimeout(500);
    assert.equal(await composingInput.evaluate((input) => input.isConnected), true, `${label}: live search replaced the input during composition`);
    assert.equal(await composingInput.evaluate((input) => document.activeElement === input), true, `${label}: search input lost focus during composition`);
    assert.equal(await composingInput.inputValue(), intermediateValue, `${label}: composing text changed before compositionend`);
    assert.deepEqual(requestQueries, [], `${label}: search requested intermediate IME text`);

    const finalSearchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === endpoint && url.searchParams.get("q") === finalValue && response.ok();
    });
    await searchInput.evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertCompositionText",
        isComposing: true
      }));
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: value }));
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: value,
        inputType: "insertText",
        isComposing: false
      }));
    }, finalValue);

    await finalSearchResponse;
    await page.waitForFunction(({ selector, value }) => {
      return document.querySelector(selector)?.value === value && !document.querySelector("#view-root .loading-state");
    }, { selector: inputSelector, value: finalValue });
    await page.waitForSelector(readySelector, { state: "visible" });
    await page.waitForTimeout(100);
    assert.deepEqual(requestQueries, [finalValue], `${label}: compositionend must submit the final text exactly once`);
    assert.equal(await page.locator(inputSelector).inputValue(), finalValue, `${label}: final IME text was not preserved`);
    await verifyResults();
  } finally {
    page.off("request", recordSearchRequest);
  }
}

async function runDesktop(browser, diagnostics) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  attachDiagnostics(page, diagnostics);

  await page.goto(`${APP_URL}/#summary`, { waitUntil: "networkidle" });
  await waitForApp(page);
  const summaryText = await page.locator("#view-root").innerText();
  for (const expected of ["127", "11,361", "11,253", "323", "82.3%", "126 / 1"]) {
    assert.ok(summaryText.includes(expected), `summary is missing ${expected}`);
  }
  const summaryLayout = await auditLayout(page, "desktop summary");
  assert.equal(summaryLayout.visibleSidebar, true, "desktop sidebar is not visible");
  assert.equal(summaryLayout.visibleBottomNav, false, "desktop bottom navigation should be hidden");
  await capture(page, "desktop-summary.png", true);

  await page.locator('a[href="#schools"]').first().click();
  await waitForRoute(page, "#schools", ".data-table.is-schools tbody tr");
  assert.equal(await page.locator(".data-table.is-schools tbody tr").count(), 127, "school table must contain 127 rows");
  await auditLayout(page, "desktop schools");
  await capture(page, "desktop-schools.png");

  await verifyImeLiveSearch(page, {
    label: "school search",
    inputSelector: "#school-query",
    endpoint: "/api/schools",
    intermediateValue: "beijing",
    finalValue: "北京大学",
    readySelector: ".data-table.is-schools tbody tr",
    verifyResults: async () => {
      assert.equal(await page.locator(".data-table.is-schools tbody tr").count(), 1, "school search must return one row");
      assert.equal(await page.getByRole("link", { name: "北京大学", exact: true }).count(), 1, "school search result is missing 北京大学");
    }
  });

  await page.getByRole("link", { name: "北京大学", exact: true }).click();
  await waitForRoute(page, "#school/", ".metric-strip");
  assert.equal(await page.locator(".page-heading h1").innerText(), "北京大学");
  assert.ok((await page.locator("#view-root").innerText()).includes("北京国际数学研究中心"), "Peking University detail is missing the math center");
  assert.ok(await page.locator('a[href^="/reports/"]').count(), "Peking University report link is missing");
  await auditLayout(page, "desktop school detail");
  await capture(page, "desktop-school-detail.png");

  await page.goto(`${APP_URL}/#faculty`, { waitUntil: "networkidle" });
  await waitForApp(page);
  await page.waitForSelector(".data-table.is-faculty tbody tr");
  assert.equal(await page.locator(".data-table.is-faculty tbody tr").count(), 20, "faculty page size must be 20");
  await page.locator(".data-table.is-faculty [data-person-id]").first().click();
  await page.waitForSelector("#person-drawer.is-open");
  await page.waitForSelector("#drawer-content .drawer-section");
  await page.waitForFunction(() => document.getElementById("person-drawer")?.getBoundingClientRect().right <= window.innerWidth + 1);
  assert.equal(await page.locator("#person-drawer").getAttribute("aria-hidden"), "false");
  await auditLayout(page, "desktop faculty drawer");
  await capture(page, "desktop-faculty-drawer.png");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("person-drawer")?.getAttribute("aria-hidden") === "true");
  await verifyImeLiveSearch(page, {
    label: "faculty search",
    inputSelector: "#faculty-query",
    endpoint: "/api/faculty",
    intermediateValue: "qiuchengtong",
    finalValue: "丘成桐",
    readySelector: ".data-table.is-faculty tbody tr",
    verifyResults: async () => {
      assert.equal(await page.locator(".data-table.is-faculty tbody tr").count(), 1, "faculty search must return one row");
      assert.equal(await page.getByRole("button", { name: "丘成桐", exact: true }).count(), 1, "faculty search result is missing 丘成桐");
    }
  });

  await page.goto(`${APP_URL}/#talents`, { waitUntil: "networkidle" });
  await waitForApp(page);
  await page.waitForSelector(".data-table.is-talents tbody tr");
  assert.equal(await page.locator(".data-table.is-talents tbody tr").count(), 20, "talent page size must be 20");
  assert.match(await page.locator(".result-bar").innerText(), /395/);
  await verifyImeLiveSearch(page, {
    label: "talent search",
    inputSelector: "#talent-query",
    endpoint: "/api/talents",
    intermediateValue: "beijingdaxue",
    finalValue: "北京大学",
    readySelector: ".data-table.is-talents tbody tr",
    verifyResults: async () => {
      assert.equal(await page.locator(".data-table.is-talents tbody tr").count(), 20, "talent search page size must be 20");
      assert.match(await page.locator(".result-bar").innerText(), /64/, "talent search total must be 64");
    }
  });
  await auditLayout(page, "desktop talents");

  await page.goto(`${APP_URL}/#compare`, { waitUntil: "networkidle" });
  await waitForApp(page);
  await page.selectOption("#compare-school", { label: "北京大学" });
  await page.locator('[data-action="add-compare"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-action="remove-compare"]').length === 1);
  await page.selectOption("#compare-school", { label: "清华大学" });
  await page.locator('[data-action="add-compare"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-action="remove-compare"]').length === 2);
  await page.waitForSelector(".compare-table");
  const compareText = await page.locator("#view-root").innerText();
  assert.ok(compareText.includes("北京大学") && compareText.includes("清华大学"), "comparison does not contain both schools");
  await auditLayout(page, "desktop compare");
  await capture(page, "desktop-compare.png", true);

  await context.close();
}

async function runMobile(browser, diagnostics) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  attachDiagnostics(page, diagnostics);

  await page.goto(`${APP_URL}/#summary`, { waitUntil: "networkidle" });
  await waitForApp(page);
  const summaryLayout = await auditLayout(page, "mobile summary");
  assert.equal(summaryLayout.visibleSidebar, false, "mobile sidebar should be hidden");
  assert.equal(summaryLayout.visibleBottomNav, true, "mobile bottom navigation is not visible");
  await capture(page, "mobile-summary.png", true);

  await page.locator('.bottom-nav a[href="#faculty"]').click();
  await waitForRoute(page, "#faculty", ".data-table.is-faculty tbody tr");
  await auditLayout(page, "mobile faculty");
  await capture(page, "mobile-faculty.png");
  await page.locator(".data-table.is-faculty [data-person-id]").first().click();
  await page.waitForSelector("#person-drawer.is-open");
  await page.waitForSelector("#drawer-content .drawer-section");
  await page.waitForFunction(() => document.getElementById("person-drawer")?.getBoundingClientRect().right <= window.innerWidth + 1);
  const drawerBox = await page.locator("#person-drawer").boundingBox();
  assert.ok(drawerBox && drawerBox.x >= -1 && drawerBox.x + drawerBox.width <= 391, "mobile drawer falls outside viewport");
  await auditLayout(page, "mobile faculty drawer");
  await capture(page, "mobile-faculty-drawer.png");

  await context.close();
}

(async () => {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], externalRequests: [] };
  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    await runDesktop(browser, diagnostics);
    await runMobile(browser, diagnostics);
    assert.deepEqual(diagnostics.consoleErrors, [], `browser console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
    assert.deepEqual(diagnostics.pageErrors, [], `page errors: ${JSON.stringify(diagnostics.pageErrors)}`);
    assert.deepEqual(diagnostics.failedRequests, [], `failed requests: ${JSON.stringify(diagnostics.failedRequests)}`);
    assert.deepEqual(diagnostics.externalRequests, [], `external requests: ${JSON.stringify(diagnostics.externalRequests)}`);
    process.stdout.write(`${JSON.stringify({ appUrl: APP_URL, screenshots: SCREENSHOT_DIR, diagnostics, allChecksPass: true }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
