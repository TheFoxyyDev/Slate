async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

const COLORS = [
  "#5aa0ff", "#57d9a3", "#ff9f5a", "#c77dff",
  "#ff6b8a", "#ffd166", "#4dd0e1", "#a3e635",
];
function colorFor(i) { return COLORS[i % COLORS.length]; }

const canvas = document.getElementById("tablet");
const ctx = canvas.getContext("2d");
const tray = document.getElementById("tray");

let displays = [];
let dirty = false;
let saved = "[]";

const HANDLE = 16;
const MIN_FRAC = 0.05;

const LOCKS_KEY = "slate.aspectLocks";
// Falls back to the pre-per-display global setting so an earlier choice carries over.
const lockDefault = localStorage.getItem("slate.lockAspect") !== "0";
let locks = {};
try { locks = JSON.parse(localStorage.getItem(LOCKS_KEY)) || {}; } catch { locks = {}; }

function lockFor(d) {
  return d.name in locks ? locks[d.name] : lockDefault;
}
function setLock(d, v) {
  locks[d.name] = v;
  localStorage.setItem(LOCKS_KEY, JSON.stringify(locks));
}

// Region w/h are fractions of the canvas, so a display's pixel aspect ratio
// becomes this w:h fraction ratio once the canvas' own aspect is divided out.
function fracAspect(d) {
  return (d.w / d.h) / (canvas.width / canvas.height);
}

function fitAspect(d, w, h, maxW, maxH) {
  const a = fracAspect(d);
  if (w / a > h) h = w / a; else w = h * a;
  if (w > maxW) { w = maxW; h = w / a; }
  if (h > maxH) { h = maxH; w = h * a; }
  if (w < MIN_FRAC) { w = MIN_FRAC; h = w / a; }
  if (h < MIN_FRAC) { h = MIN_FRAC; w = h * a; }
  return { w: Math.min(w, maxW), h: Math.min(h, maxH) };
}

function displaysMap() {
  const map = {};
  displays.forEach((d) => {
    if (d.enabled) map[d.name] = { tablet_region: d.tablet_region, enabled: true };
  });
  return map;
}

function setDirty(v) {
  dirty = v;
  const el = document.getElementById("dirty");
  if (el) el.hidden = !v;
  const revert = document.getElementById("revert");
  if (revert) revert.hidden = !v;
}

let previewPending = false;
function schedulePreview() {
  setDirty(true);
  if (previewPending) return;
  previewPending = true;
  requestAnimationFrame(() => {
    previewPending = false;
    fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displays: displaysMap() }),
    }).catch(() => {});
  });
}

function regionPx(r) {
  return { x: r.x * canvas.width, y: r.y * canvas.height, w: r.w * canvas.width, h: r.h * canvas.height };
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0f16";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const step = 28;
  for (let x = step; x < canvas.width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = step; y < canvas.height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.strokeStyle = "#33334a";
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

  displays.forEach((d, i) => {
    if (!d.enabled) return;
    const p = regionPx(d.tablet_region);
    const c = colorFor(i);

    ctx.fillStyle = c + "40";
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    ctx.fillStyle = c;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(d.name, p.x + 8, p.y + 20);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`${d.w}×${d.h}${lockFor(d) ? " · aspect locked" : ""}`, p.x + 8, p.y + 36);

    ctx.fillStyle = c;
    ctx.fillRect(p.x + p.w - HANDLE, p.y + p.h - HANDLE, HANDLE, HANDLE);
    ctx.strokeStyle = "#0f0f16";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x + p.w - HANDLE + 4, p.y + p.h - 3);
    ctx.lineTo(p.x + p.w - 3, p.y + p.h - HANDLE + 4);
    ctx.stroke();

    const cx = p.x + p.w - HANDLE / 2 - 3, cy = p.y + HANDLE / 2 + 3;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.arc(cx, cy, HANDLE / 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    const k = 3.5;
    ctx.beginPath();
    ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k);
    ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k);
    ctx.stroke();
  });
}

function renderTray() {
  tray.innerHTML = "";
  const unplaced = displays.filter((d) => !d.enabled);
  if (unplaced.length === 0) {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = displays.length ? "All displays placed." : "No displays detected.";
    tray.appendChild(span);
    return;
  }
  unplaced.forEach((d) => {
    const i = displays.indexOf(d);
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.style.borderColor = colorFor(i);
    chip.innerHTML = `<strong>${d.name}</strong><span class="muted">${d.w}×${d.h}${lockFor(d) ? " · aspect locked" : ""}</span>`;
    chip.addEventListener("pointerdown", (e) => startTrayDrag(e, d));
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e, d);
    });
    tray.appendChild(chip);
  });
}

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width * canvas.width,
    y: (e.clientY - rect.top) / rect.height * canvas.height,
  };
}
function overCanvas(e) {
  const rect = canvas.getBoundingClientRect();
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
}

function startTrayDrag(e, d) {
  if (e.button !== 0) return;
  e.preventDefault();
  const onMove = (ev) => {
    canvas.style.outline = overCanvas(ev) ? "2px solid " + colorFor(displays.indexOf(d)) : "";
  };
  const onUp = (ev) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    canvas.style.outline = "";
    if (!overCanvas(ev)) return;
    const p = canvasPos(ev);
    const canvasAspect = canvas.width / canvas.height;
    const monAspect = d.w / d.h;
    let h = 0.5;
    let w = h * (monAspect / canvasAspect);
    if (w > 0.9) { w = 0.9; h = w * (canvasAspect / monAspect); }
    let x = p.x / canvas.width - w / 2;
    let y = p.y / canvas.height - h / 2;
    x = Math.min(Math.max(x, 0), 1 - w);
    y = Math.min(Math.max(y, 0), 1 - h);
    d.enabled = true;
    d.tablet_region = { x, y, w, h };
    renderTray();
    draw();
    schedulePreview();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function hitTest(pos) {
  for (let i = displays.length - 1; i >= 0; i--) {
    const d = displays[i];
    if (!d.enabled) continue;
    const p = regionPx(d.tablet_region);
    const cx = p.x + p.w - HANDLE / 2 - 3, cy = p.y + HANDLE / 2 + 3;
    if (Math.hypot(pos.x - cx, pos.y - cy) <= HANDLE / 2 + 2) return { d, mode: "close" };
    if (pos.x >= p.x + p.w - HANDLE && pos.x <= p.x + p.w && pos.y >= p.y + p.h - HANDLE && pos.y <= p.y + p.h)
      return { d, mode: "resize" };
    if (pos.x >= p.x && pos.x <= p.x + p.w && pos.y >= p.y && pos.y <= p.y + p.h)
      return { d, mode: "move", grab: { dx: pos.x - p.x, dy: pos.y - p.y } };
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  hideMenu();
  const pos = canvasPos(e);
  const hit = hitTest(pos);
  if (!hit) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);

  if (hit.mode === "close") {
    hit.d.enabled = false;
    renderTray();
    draw();
    schedulePreview();
    return;
  }

  const onMove = (ev) => {
    const p = canvasPos(ev);
    const r = hit.d.tablet_region;
    if (hit.mode === "move") {
      let x = (p.x - hit.grab.dx) / canvas.width;
      let y = (p.y - hit.grab.dy) / canvas.height;
      r.x = Math.min(Math.max(x, 0), 1 - r.w);
      r.y = Math.min(Math.max(y, 0), 1 - r.h);
    } else if (lockFor(hit.d)) {
      const fit = fitAspect(hit.d, p.x / canvas.width - r.x, p.y / canvas.height - r.y, 1 - r.x, 1 - r.y);
      r.w = fit.w;
      r.h = fit.h;
    } else {
      r.w = Math.min(Math.max(p.x / canvas.width - r.x, MIN_FRAC), 1 - r.x);
      r.h = Math.min(Math.max(p.y / canvas.height - r.y, MIN_FRAC), 1 - r.y);
    }
    draw();
    schedulePreview();
  };
  const onUp = () => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
});

const menu = document.getElementById("ctxmenu");
const lockItem = document.getElementById("ctx-lock");
const menuTitle = document.getElementById("ctx-title");
const menuEmpty = document.getElementById("ctx-empty");
let menuTarget = null;

function hideMenu() {
  menu.hidden = true;
  menuTarget = null;
}

function showMenu(e, d) {
  menuTarget = d || null;
  menuTitle.hidden = !d;
  lockItem.hidden = !d;
  menuEmpty.hidden = !!d;
  if (d) {
    menuTitle.textContent = d.name;
    menuTitle.style.color = colorFor(displays.indexOf(d));
    lockItem.setAttribute("aria-checked", lockFor(d) ? "true" : "false");
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  const x = Math.min(e.clientX, window.innerWidth - r.width - 8);
  const y = Math.min(e.clientY, window.innerHeight - r.height - 8);
  menu.style.left = Math.max(8, x) + "px";
  menu.style.top = Math.max(8, y) + "px";
}

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const hit = hitTest(canvasPos(e));
  showMenu(e, hit && hit.d);
});

lockItem.addEventListener("click", () => {
  const d = menuTarget;
  hideMenu();
  if (!d) return;
  const on = !lockFor(d);
  setLock(d, on);
  renderTray();
  draw();
  if (!on || !d.enabled) return;
  const r = d.tablet_region;
  const fit = fitAspect(d, r.w, r.h, 1 - r.x, 1 - r.y);
  if (Math.abs(fit.w - r.w) < 1e-4 && Math.abs(fit.h - r.h) < 1e-4) return;
  r.w = fit.w;
  r.h = fit.h;
  draw();
  schedulePreview();
});

window.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !menu.contains(e.target)) hideMenu();
}, true);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMenu();
});
window.addEventListener("scroll", hideMenu, true);
window.addEventListener("blur", hideMenu);

async function clearPreview() {
  await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true }),
  }).catch(() => {});
}

document.getElementById("revert").addEventListener("click", async () => {
  displays = JSON.parse(saved);
  setDirty(false);
  renderTray();
  draw();
  await clearPreview();
  const status = document.getElementById("status");
  status.textContent = "Reverted";
  setTimeout(() => { status.textContent = ""; }, 1500);
});

async function load() {
  await clearPreview();
  const data = await fetchJSON("/api/displays");
  displays = data.displays || [];
  saved = JSON.stringify(displays);
  setDirty(false);
  renderTray();
  draw();
  const info = await fetchJSON("/api/info");
  document.getElementById("info").textContent =
    `Open this address on your tablet's browser: http://${info.ip}:${info.port}/`;
  const v = document.getElementById("version");
  if (v && info.version) v.textContent = info.version;
}

document.getElementById("save").addEventListener("click", async () => {
  await fetchJSON("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displays: displaysMap() }),
  });
  saved = JSON.stringify(displays);
  setDirty(false);
  const status = document.getElementById("status");
  status.textContent = "Saved ✓";
  setTimeout(() => { status.textContent = ""; }, 1500);
});

window.addEventListener("pagehide", () => {
  if (!dirty) return;
  navigator.sendBeacon(
    "/api/preview",
    new Blob([JSON.stringify({ clear: true })], { type: "application/json" })
  );
});

load();
