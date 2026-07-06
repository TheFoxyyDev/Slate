#!/usr/bin/env python3

import argparse
import json
import socket
from pathlib import Path

from aiohttp import web, WSMsgType
import qrcode
import uinput

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
STATIC_DIR = BASE_DIR / "static"

DEFAULT_CONFIG = {
    "screen_area": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    "tablet_area": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
    "abs_range": 32767,
}


def load_config():
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text())
            cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # Deep copy
            for k in ("screen_area", "tablet_area"):
                if k in data:
                    cfg[k].update(data[k])
            if "abs_range" in data:
                cfg["abs_range"] = data["abs_range"]
            return cfg
        except Exception as e:
            print(f"[warn] failed to load config.json ({e}), using defaults")
    return json.loads(json.dumps(DEFAULT_CONFIG))


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


config = load_config()
ABS_MAX = config["abs_range"]

# Expose the device as a generic absolute pointer instead of a tablet so it
# works consistently across X11 and Wayland.
device = uinput.Device(
    [
        uinput.ABS_X + (0, ABS_MAX, 0, 0),
        uinput.ABS_Y + (0, ABS_MAX, 0, 0),
        uinput.ABS_PRESSURE + (0, 1023, 0, 0),
        uinput.BTN_LEFT,
        uinput.BTN_RIGHT,
    ],
    name="OsuTabletBridge",
)


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def map_point(nx, ny, cfg):
    """Map normalized tablet coordinates into absolute device coordinates."""
    ta = cfg["tablet_area"]
    rel_x = (nx - ta["x"]) / max(ta["w"], 1e-6)
    rel_y = (ny - ta["y"]) / max(ta["h"], 1e-6)
    rel_x = clamp(rel_x)
    rel_y = clamp(rel_y)

    sa = cfg["screen_area"]
    out_x = clamp(sa["x"] + rel_x * sa["w"])
    out_y = clamp(sa["y"] + rel_y * sa["h"])

    abs_max = cfg["abs_range"]
    return int(out_x * abs_max), int(out_y * abs_max)


def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue

            t = data.get("type")
            if t not in ("move", "down", "up"):
                continue

            # Motion only. Clicking is intentionally handled externally (e.g.
            # keyboard bindings), matching a typical osu! tablet setup.
            nx = float(data.get("x", 0.0))
            ny = float(data.get("y", 0.0))
            x, y = map_point(nx, ny, config)

            device.emit(uinput.ABS_X, x, syn=False)
            device.emit(uinput.ABS_Y, y, syn=False)

            pressure = data.get("pressure")
            if pressure is not None:
                device.emit(
                    uinput.ABS_PRESSURE,
                    int(clamp(float(pressure)) * 1023),
                    syn=False,
                )

            device.syn()

        elif msg.type == WSMsgType.ERROR:
            print(f"[ws] connection closed with exception {ws.exception()}")

    return ws


async def get_settings(request):
    return web.json_response(config)


async def post_settings(request):
    data = await request.json()
    for key in ("screen_area", "tablet_area"):
        if key in data:
            config[key].update(data[key])
    save_config(config)
    return web.json_response(config)


async def get_info(request):
    return web.json_response({"ip": get_local_ip(), "port": request.app["port"]})


async def index(request):
    return web.FileResponse(STATIC_DIR / "tablet.html")


async def config_page(request):
    return web.FileResponse(STATIC_DIR / "config.html")


def main():
    parser = argparse.ArgumentParser(description="Osu Tablet Bridge server")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    app = web.Application()
    app["port"] = args.port

    app.router.add_get("/", index)
    app.router.add_get("/config", config_page)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/settings", get_settings)
    app.router.add_post("/api/settings", post_settings)
    app.router.add_get("/api/info", get_info)
    app.router.add_static("/static", str(STATIC_DIR), show_index=False)

    ip = get_local_ip()
    tablet_url = f"http://{ip}:{args.port}/"

    print("Osu Tablet Bridge running.")
    print(f"  On this PC, configure: http://localhost:{args.port}/config")
    print(f"  On your tablet, open:  {tablet_url}")
    print()
    print("  Or scan this on your tablet:")
    print()

    qr = qrcode.QRCode(border=1)
    qr.add_data(tablet_url)
    qr.make()

    try:
        qr.print_ascii(tty=True)
    except OSError:
        # Fallback when stdout is not a TTY.
        qr.print_ascii(tty=False)

    print()

    web.run_app(app, host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()
