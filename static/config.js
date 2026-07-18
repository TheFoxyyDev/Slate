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

const HANDLE = 16;
const MIN_FRAC = 0.05;

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
    ctx.fillText(`${d.w}×${d.h}`, p.x + 8, p.y + 36);

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
    chip.innerHTML = `<strong>${d.name}</strong><span class="muted">${d.w}×${d.h}</span>`;
    chip.addEventListener("pointerdown", (e) => startTrayDrag(e, d));
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
    const w = 0.4, h = 0.4;
    let x = p.x / canvas.width - w / 2;
    let y = p.y / canvas.height - h / 2;
    x = Math.min(Math.max(x, 0), 1 - w);
    y = Math.min(Math.max(y, 0), 1 - h);
    d.enabled = true;
    d.tablet_region = { x, y, w, h };
    renderTray();
    draw();
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
  const pos = canvasPos(e);
  const hit = hitTest(pos);
  if (!hit) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);

  if (hit.mode === "close") {
    hit.d.enabled = false;
    renderTray();
    draw();
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
    } else {
      r.w = Math.min(Math.max(p.x / canvas.width - r.x, MIN_FRAC), 1 - r.x);
      r.h = Math.min(Math.max(p.y / canvas.height - r.y, MIN_FRAC), 1 - r.y);
    }
    draw();
  };
  const onUp = () => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
});

async function load() {
  const data = await fetchJSON("/api/displays");
  displays = data.displays || [];
  renderTray();
  draw();
  const info = await fetchJSON("/api/info");
  document.getElementById("info").textContent =
    `Open this address on your tablet's browser: http://${info.ip}:${info.port}/`;
}

document.getElementById("save").addEventListener("click", async () => {
  const map = {};
  displays.forEach((d) => {
    if (d.enabled) map[d.name] = { tablet_region: d.tablet_region, enabled: true };
  });
  await fetchJSON("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displays: map }),
  });
  const status = document.getElementById("status");
  status.textContent = "Saved ✓";
  setTimeout(() => { status.textContent = ""; }, 1500);
});

load();
