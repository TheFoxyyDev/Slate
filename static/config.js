async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

function setupAreaEditor(canvas, fieldsContainer, getArea, setArea, onChange) {
  const ctx = canvas.getContext("2d");
  let dragging = false;
  let start = null;

  function draw() {
    const a = getArea();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0f0f16";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#33334a";
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    const rx = a.x * canvas.width, ry = a.y * canvas.height;
    const rw = a.w * canvas.width, rh = a.h * canvas.height;
    ctx.fillStyle = "rgba(90,160,255,0.35)";
    ctx.strokeStyle = "#5aa0ff";
    ctx.lineWidth = 2;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
  }

  function posFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    start = posFromEvent(e);
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const cur = posFromEvent(e);
    const x = Math.min(start.x, cur.x);
    const y = Math.min(start.y, cur.y);
    const w = Math.max(Math.abs(cur.x - start.x), 0.01);
    const h = Math.max(Math.abs(cur.y - start.y), 0.01);
    setArea({ x, y, w, h });
    syncFields();
    draw();
    onChange && onChange();
  });
  window.addEventListener("mouseup", () => { dragging = false; });

  const inputs = {};
  ["x", "y", "w", "h"].forEach((key) => {
    const label = document.createElement("label");
    label.textContent = key.toUpperCase() + " %";
    const input = document.createElement("input");
    input.type = "number";
    input.min = 0; input.max = 100; input.step = 0.5;
    input.addEventListener("input", () => {
      const a = { ...getArea() };
      a[key] = Math.min(Math.max(parseFloat(input.value) || 0, 0), 100) / 100;
      setArea(a);
      draw();
      onChange && onChange();
    });
    label.appendChild(input);
    fieldsContainer.appendChild(label);
    inputs[key] = input;
  });

  function syncFields() {
    const a = getArea();
    inputs.x.value = (a.x * 100).toFixed(1);
    inputs.y.value = (a.y * 100).toFixed(1);
    inputs.w.value = (a.w * 100).toFixed(1);
    inputs.h.value = (a.h * 100).toFixed(1);
  }

  return { draw, syncFields };
}

let config = {
  screen_area: { x: 0, y: 0, w: 1, h: 1 },
  tablet_area: { x: 0, y: 0, w: 1, h: 1 },
};

const screenEditor = setupAreaEditor(
  document.getElementById("screenCanvas"),
  document.getElementById("screenFields"),
  () => config.screen_area,
  (a) => { config.screen_area = a; }
);

const tabletEditor = setupAreaEditor(
  document.getElementById("tabletCanvas"),
  document.getElementById("tabletFields"),
  () => config.tablet_area,
  (a) => { config.tablet_area = a; }
);

async function load() {
  config = await fetchJSON("/api/settings");
  screenEditor.syncFields(); screenEditor.draw();
  tabletEditor.syncFields(); tabletEditor.draw();
  const info = await fetchJSON("/api/info");
  document.getElementById("info").textContent =
    `Open this address on your tablet's browser: http://${info.ip}:${info.port}/`;
}

document.getElementById("save").addEventListener("click", async () => {
  await fetchJSON("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const status = document.getElementById("status");
  status.textContent = "Saved ✓";
  setTimeout(() => { status.textContent = ""; }, 1500);
});

load();
