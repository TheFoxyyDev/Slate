const canvas = document.getElementById("area");
const hud = document.getElementById("hud");
const ctx = canvas.getContext("2d");

let ws = null;
let connected = false;
let lastPointerType = "-";

let regions = [];
let dirty = false;

const REGION_COLORS = [
  "#5aa0ff", "#57d9a3", "#ff9f5a", "#c77dff",
  "#ff6b8a", "#ffd166", "#4dd0e1", "#a3e635",
];

async function refreshArea() {
  try {
    const res = await fetch("/api/overlay");
    const data = await res.json();
    regions = data.regions || [];
    dirty = !!data.dirty;
    const banner = document.getElementById("unsaved");
    if (banner) banner.hidden = !dirty;
    draw();
  } catch (e) {
  }
}
refreshArea();
setInterval(refreshArea, 300);

fetch("/api/info").then((r) => r.json()).then((d) => {
  const el = document.getElementById("version");
  if (el && d.version) el.textContent = d.version;
}).catch(() => {});

function resize() {
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  draw();
}
window.addEventListener("resize", resize);

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { connected = true; updateHud(); };
  ws.onclose = () => { connected = false; updateHud(); setTimeout(connect, 1000); };
  ws.onerror = () => { connected = false; updateHud(); };
}
connect();

function updateHud() {
  hud.textContent = connected
    ? `connected, pointer: ${lastPointerType}`
    : "reconnecting…";
  draw();
}

function send(type, e) {
  if (!connected || ws.readyState !== WebSocket.OPEN) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  ws.send(JSON.stringify({
    type,
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
    pressure: e.pressure ?? 0,
    tiltX: e.tiltX ?? 0,
    tiltY: e.tiltY ?? 0,
    pointerType: e.pointerType,
  }));
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  lastPointerType = e.pointerType;
  send("down", e);
  updateHud();
});
canvas.addEventListener("pointermove", (e) => {
  e.preventDefault();
  lastPointerType = e.pointerType;
  send("move", e);
});
canvas.addEventListener("pointerup", (e) => {
  e.preventDefault();
  send("up", e);
});
canvas.addEventListener("pointercancel", (e) => {
  send("up", e);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function draw() {
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  const w = window.innerWidth, h = window.innerHeight;

  ctx.fillStyle = connected ? "#0f1a2b" : "#2b0f0f";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  const step = 40;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, h);
  const base = connected ? "#0f1a2b" : "#2b0f0f";
  regions.forEach((r) => {
    ctx.fillStyle = base;
    ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
  });

  regions.forEach((r, i) => {
    const c = REGION_COLORS[i % REGION_COLORS.length];
    const ax = r.x * w, ay = r.y * h, aw = r.w * w, ah = r.h * h;
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    ctx.strokeRect(ax, ay, aw, ah);
    ctx.fillStyle = c;
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(r.name, ax + 8, ay + 20);

    // Draw center dot
    ctx.beginPath();
    ctx.arc(ax + aw / 2, ay + ah / 2, 1.25, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255, 0, 0, 0.25)";
    ctx.fill();
  });
}

resize();
