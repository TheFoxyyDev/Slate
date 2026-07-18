# Slate

Turns a phone/tablet's browser into a real Linux input device — the same way a
Wacom or XP-Pen tablet works — over your local network. No app to install on
the tablet; it just needs a browser.

A *slate* is the original tablet: a thin sheet you write on, wipe, and reuse.

- **Absolute positioning**: works like a real drawing tablet, not a relative
  mouse.
- **Active area / target area**: crop which part of the tablet's surface is
  "live," and map it onto any region of your screen.
- **Works on X11 and Wayland**: input is injected via `/dev/uinput` at the
  kernel level, so it works the same regardless of compositor.
- **Single static binary**: the HTML/JS/CSS are embedded, so the compiled
  binary is all you need to ship.

## Build

```bash
go build -o slate .
```

That produces a self-contained `slate` binary (pages embedded).

## /dev/uinput permissions (one-time)

The server writes to `/dev/uinput`. Grant your user access once:

```bash
sudo modprobe uinput
echo 'KERNEL=="uinput", MODE="0660", GROUP="input"' | sudo tee /etc/udev/rules.d/99-uinput.rules
sudo udevadm control --reload-rules
sudo usermod -aG input "$USER"   # then log out and back in
```

If it can't open the device on startup it exits with a clear error.

## Run

```bash
./slate                # defaults to port 8765
./slate --port 9000
```

It prints the tablet URL and a scannable QR code. On your phone/tablet, open
that URL (or scan the QR) in a browser and start moving your pen/finger.

Clicking is currently **not** injected — movement-only. Binding the click to a
keyboard key (and, soon, to a pen button) is handled separately.

## Configuring the area mapping

On the PC, open:

```
http://localhost:8765/config
```

Drag or type percentages to set the **screen target area** and **tablet active
area**. Settings are saved to:

```
$XDG_CONFIG_HOME/slate/config.json   (usually ~/.config/slate/config.json)
```

and persist across runs. To reset the mapping, delete that file.

## Notes

- Both devices need to be on the same local network.
- There's no authentication — anyone on your LAN can connect while it's
  running. Fine for a home network.
