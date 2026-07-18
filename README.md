# Slate

Turns a phone/tablet's browser into a real Linux input device, the same way a
Wacom or XP-Pen tablet works, over your local network. No app to install on
the tablet; it just needs a browser.

A *slate* is the original tablet: a thin sheet you write on, wipe, and reuse.

- **Absolute positioning**: works like a real drawing tablet, not a relative
  mouse.
- **Per-display mapping**: your connected monitors are detected automatically.
  Drag each one onto a canvas of your tablet surface to choose which slice of
  the tablet drives which monitor. Every display keeps its own mapping.
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

Clicking is currently **not** injected; it's movement-only. Binding the click
to a keyboard key (and, soon, to a pen button) is handled separately.

## Configuring the display mapping

On the PC, open:

```
http://localhost:8765/config
```

Your connected displays (detected via `xrandr`) appear in a tray. **Drag a
display onto the tablet canvas** to map it, then drag it to move, drag its
corner to resize, or tap × to remove it. A display's rectangle is the part of
the tablet that drives that monitor; its screen target is derived from the
monitor's real position in your desktop layout. Tablet areas covered by no
display are dead.

Settings are stored **per display** (keyed by monitor name, so each is
remembered independently) in:

```
$XDG_CONFIG_HOME/slate/config.json   (usually ~/.config/slate/config.json)
```

and persist across runs. To reset all mappings, delete that file.

## Notes

- Both devices need to be on the same local network.
- There's no authentication; anyone on your LAN can connect while it's
  running. Fine for a home network.
