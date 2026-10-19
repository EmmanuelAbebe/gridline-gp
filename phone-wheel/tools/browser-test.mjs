// Browser check for the phone page. Needs a dry-run server and Playwright:
//   python server.py --dry-run --port 8450 &
//   npm i playwright && npx playwright install chromium-headless-shell
//   OUT=/tmp/shots node tools/browser-test.mjs
import { chromium } from "playwright";
const OUT = process.env.OUT || ".";
import { readFileSync } from "fs";
const TOKEN = readFileSync(new URL("../pairing_token", import.meta.url), "utf8").trim();
const BASE = "https://127.0.0.1:8450/";
const URL_ = BASE + "?t=" + TOKEN;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
let last = null, sent = [];
page.on("websocket", (ws) => ws.on("framesent", (f) => { try { last = JSON.parse(f.payload); sent.push(last); } catch (_) {} }));
const wait = (ms) => page.waitForTimeout(ms);
// Portrait-angle tilt: theta degrees clockwise (steer right) -> beta = 90 - theta, gamma = 90.
const tilt = (theta, n = 40) => page.evaluate(async ([t, n]) => {
  for (let i = 0; i < n; i++) {
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: 90 - t, gamma: 90 }));
    await new Promise((r) => setTimeout(r, 10));
  }
}, [theta, n]);
const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);

await page.goto(URL_);
await page.screenshot({ path: `${OUT}/1-start.png` });
await page.click("text=START DRIVING");
await tilt(0, 30);           // level, gets auto-centered at 400 ms
await wait(600);
await page.screenshot({ path: `${OUT}/2-drive.png` });
check("connected", await page.isVisible("text=connected to PC"));

await tilt(20); await wait(100);
check("tilt right 20° -> s ≈ +0.44", last && Math.abs(last.s - 20 / 45) < 0.03, JSON.stringify(last));
await tilt(-20); await wait(100);
check("tilt left 20° -> s ≈ -0.44", last && Math.abs(last.s + 20 / 45) < 0.03, JSON.stringify(last));
await tilt(0); await wait(100);

const gas = await page.locator(".pedal.gas").boundingBox();
await page.mouse.move(gas.x + gas.width / 2, gas.y + gas.height / 2);
await page.mouse.down(); await wait(800);
check("gas ramp after 0.8 s ≈ 0.63", last && last.g > 0.5 && last.g < 0.75, JSON.stringify(last));
await page.mouse.up(); await wait(100);
check("gas released", last && last.g === 0, JSON.stringify(last));

const b1 = await page.locator(".auxbtn").first().boundingBox();
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
await page.mouse.down(); await wait(100);
check("button 1 -> A (k=1)", last && last.k === 1, JSON.stringify(last));
await page.mouse.up(); await wait(100);
check("button released (k=0)", last && last.k === 0);

// flick to shift: on the brake (left) flick right = LB (bit 4 = 16), twice = two separate presses; on the gas
// (right) flick left = RB (32); the pedal stays pressed; a slow slide does nothing
const presses = (bit) => sent.reduce((n, m, i) => n + ((m.k & bit) && !(i && sent[i - 1].k & bit) ? 1 : 0), 0);
const flick = async (box, dir, times = 1, steps = 4) => {
  const x0 = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x0, y); await page.mouse.down(); await wait(120);
  for (let n = 0; n < times; n++) {
    await page.mouse.move(x0 + dir * 70, y, { steps }); await wait(steps > 10 ? 0 : 60);
    await page.mouse.move(x0, y, { steps: 40 }); await wait(250);   // slow return: not a flick
  }
};
const brakeBox = await page.locator(".pedal.brake").boundingBox();
sent = []; await flick(brakeBox, +1, 2);
check("flick on brake -> 2 × LB, brake held", presses(16) === 2 && presses(32) === 0 && last.b > 0, `LB=${presses(16)} b=${last.b}`);
await page.mouse.up(); await wait(100);
sent = []; await flick(gas, -1);
check("flick on gas -> RB", presses(32) === 1 && presses(16) === 0, `RB=${presses(32)}`);
await page.mouse.up(); await wait(100);
sent = []; await flick(brakeBox, -1);
check("flick away from the centre does nothing", presses(16) + presses(32) === 0);
await page.mouse.up(); await wait(100);
sent = []; await flick(brakeBox, +1, 1, 40);
check("slow sideways slide does nothing", presses(16) + presses(32) === 0);
await page.mouse.up(); await wait(150);
await page.screenshot({ path: `${OUT}/2b-flick.png` });

// settings
await page.click("text=⚙ Settings");
await tilt(10); await wait(100);
await page.mouse.move(gas.x + 10, gas.y + 10);
check("settings open: pedals paused, steering live", last && last.g === 0 && Math.abs(last.s - 10 / 45) < 0.03, JSON.stringify(last));
for (const t of ["Steering", "Pedals", "Buttons", "Layout", "Profiles"]) {
  await page.click(`.settings nav >> text=${t}`);
  await wait(150);
  await page.screenshot({ path: `${OUT}/3-settings-${t}.png` });
}
// rebind button 1 to D-pad up, make it a toggle
await page.click(".settings nav >> text=Buttons");
await page.locator(".btnrow select").first().selectOption("UP");
await page.locator(".btnrow .switch").first().click();
// pedals: gas -> slide mode
await page.click(".settings nav >> text=Pedals");
await page.click(".seg >> text=Slide");
// layout: swap pedals, large buttons
await page.click(".settings nav >> text=Layout");
await page.locator(".field", { hasText: "Swap pedals" }).locator("button").click();
await page.click(".seg >> text=Large");
await page.click("text=Done");
await tilt(0); await wait(200);
await page.screenshot({ path: `${OUT}/4-drive-custom.png` });

const b1b = await page.locator(".auxbtn").first().boundingBox();
await page.mouse.click(b1b.x + b1b.width / 2, b1b.y + b1b.height / 2); await wait(100);
check("rebound toggle button -> D-pad up (k=2048) stays on", last && last.k === 2048, JSON.stringify(last));
await page.mouse.click(b1b.x + b1b.width / 2, b1b.y + b1b.height / 2); await wait(100);
check("second tap toggles off", last && last.k === 0, JSON.stringify(last));

const gasL = await page.locator(".pedal.gas").boundingBox();
check("pedals swapped (gas on the left)", gasL.x < 300, `x=${gasL.x}`);
await page.mouse.move(gasL.x + gasL.width / 2, gasL.y + gasL.height - 5);
await page.mouse.down(); await wait(60);
const low = last.g;
await page.mouse.move(gasL.x + gasL.width / 2, gasL.y + 10, { steps: 5 }); await wait(80);
const high = last.g;
await page.mouse.up(); await wait(60);
check("slide gas: bottom low, top full", low < 0.3 && high > 0.95, `low=${low} high=${high}`);

// persistence
await page.reload();
await page.click(".overlay button:has-text(\"Settings\")");
await page.click(".settings nav >> text=Buttons");
check("settings survive reload", (await page.locator(".btnrow select").first().inputValue()) === "UP");

// profiles: save as new, export, import
await page.click(".settings nav >> text=Profiles");
await page.fill(".field input.text", "Drift");
await page.click(".field button:text-is(\"Save\")");
check("profile saved and active", (await page.textContent(".profile-name")) === "Drift");
await page.click("button:text-is(\"Export\")");
const exported = await page.inputValue("textarea.io");
await page.click("button:text-is(\"Import\")");
check("export + import makes a new profile", (await page.textContent(".profile-name")) === "Drift 2", exported.slice(0, 60));
await page.screenshot({ path: `${OUT}/5-profiles.png` });

const classic = await ctx.newPage();
await classic.goto(BASE + "classic");
check("/classic still served", await classic.isVisible("text=START DRIVING"));

// pairing: a phone with a wrong code is told so, and the PC page shows the connected phone
const stranger = await browser.newContext({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
const sp = await stranger.newPage();
await sp.goto(BASE + "?t=wrong-code-123456");
await sp.click("text=START DRIVING");
await sp.waitForTimeout(1200);
check("wrong pairing code -> 'not paired' shown", await sp.isVisible("text=not paired"));
const fresh = await (await browser.newContext({ ignoreHTTPSErrors: true, isMobile: true })).newPage();
await fresh.goto(BASE);
check("no code at all -> start screen asks to scan", await fresh.isVisible("text=Not paired yet"));
await page.goto(URL_);
await page.click("text=START DRIVING");
await wait(500);
const pc = await (await browser.newContext({ viewport: { width: 1100, height: 620 } })).newPage();
await pc.goto("http://127.0.0.1:8451/");
await tilt(15, 60);
await pc.waitForTimeout(400);
check("PC page shows the connected phone", await pc.isVisible("text=Phone connected"));
await pc.screenshot({ path: `${OUT}/6-pc-pair.png` });
check("no console errors", errors.filter((e) => !e.includes("403")).length === 0, errors.join(" | "));
await browser.close();
