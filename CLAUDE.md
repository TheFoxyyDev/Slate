# Slate project notes

## Versioning

- The single source of truth for the version is the `version` const in `main.go` (currently `v1.4`).
- It is served by `/api/info` and shown on both pages: bottom-left corner of the tablet page, and next to the title on the config page.
- Bump this `version` const **once per commit, not once per change**. Several edits (or several rounds of follow-up work) that land in the same commit all share one version number. Leave the const alone while iterating; set it as part of making the commit.
- This is how you confirm the running binary is actually the latest build.
- Commit subjects are `{version} - {summary}`, e.g. `v1.4 - Per-display aspect lock with context menu`. The version in the subject is the `version` const that commit ships, so the log doubles as a version history. Commits before `v1.4` predate this convention and are not formatted this way.

## Embedded web assets (important)

- Everything under `static/` is compiled into the binary via `//go:embed static` in `main.go`.
- Editing a file in `static/` has NO effect on a running server. You must:
  1. `go build -o slate .`
  2. Restart the server (kill the old process; an already-running instance keeps serving the old embedded assets).
  3. Refresh the tablet browser. Responses are sent with `Cache-Control: no-cache`, so a normal refresh is enough; use a hard refresh if in doubt.
- Quick check: the version marker on the page should match the `version` const you built. If it does not, you are hitting an old process or a cached page.
- Asset URLs are version-stamped: the served HTML references `/static/tablet.js?v=__VERSION__` etc., and `serveEmbedded` substitutes the `version` const at request time. Bumping `version` therefore forces browsers to fetch fresh JS/CSS.
- If a device has an old HTML document cached (from before no-cache headers existed), load the page once with a throwaway query string (e.g. `http://IP:PORT/?fresh`) to pull a fresh document; after that it stays current on its own.
