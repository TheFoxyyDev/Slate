const canvas = document.getElementById("area");
const hud = document.getElementById("hud");
const ctx = canvas.getContext("2d");

let ws = null;
let connected = false;
let lastPointerType = "-";

let tabletArea = { x: 0, y: 0, w: 1, h: 1 };

async function refreshArea() {
  try {
    const res = await fetch("/api/settings");
    const cfg = await res.json();
    if (cfg.tablet_area) tabletArea = cfg.tablet_area;
    draw();
  } catch (e) {
    // Ignore temporary connection issues.
  }
}

refreshArea();
setInterval(refreshArea, 3000);

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

  ws.onopen = () => {
    connected = true;
    updateHud();
  };

  ws.onclose = () => {
    connected = false;
    updateHud();
    setTimeout(connect, 1000);
  };

  ws.onerror = () => {
    connected = false;
    updateHud();
  };
}

connect();

function updateHud() {
  hud.textContent = connected
  ? `connected — pointer: ${lastPointerType}`
  : "reconnecting…";

  draw();
}

function send(type, e) {
  if (!connected || ws.readyState !== WebSocket.OPEN) return;

  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  ws.send(
    JSON.stringify({
      type,
      x: Math.min(Math.max(x, 0), 1),
                   y: Math.min(Math.max(y, 0), 1),
                   pressure: e.pressure ?? 0,
                   tiltX: e.tiltX ?? 0,
                   tiltY: e.tiltY ?? 0,
                   pointerType: e.pointerType,
    })
  );
}

// Hover events are forwarded too; clicking is handled by the server.
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

  const w = window.innerWidth;
  const h = window.innerHeight;

  ctx.fillStyle = connected ? "#0f1a2b" : "#2b0f0f";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  const step = 40;

  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const ax = tabletArea.x * w;
  const ay = tabletArea.y * h;
  const aw = tabletArea.w * w;
  const ah = tabletArea.h * h;

  // Darken everything outside the active area.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, ay);
  ctx.fillRect(0, ay + ah, w, h - (ay + ah));
  ctx.fillRect(0, ay, ax, ah);
  ctx.fillRect(ax + aw, ay, w - (ax + aw), ah);

  ctx.strokeStyle = "#5aa0ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(ax, ay, aw, ah);

  ctx.fillStyle = "#5aa0ff";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("active area", ax + 8, ay + 20);
}

resize();
