# Evergreen Course Map

An independent, shareable course planner for [The Evergreen State College](https://www.evergreen.edu/). The live site lets students choose a catalog year, class standing, interests, learning formats, and a credit target; explore three suggested paths; and build their own fall/winter/spring plan. The browser saves choices and draft plans in a first-party cookie. No account or analytics service is used.

## Catalog data

`scripts/sync_catalog.py` reads Evergreen's public [course catalog](https://www.evergreen.edu/catalog/) and linked public schedules. It writes a static JSON snapshot to `data/`. GitHub Actions refreshes the newest catalog each week and deploys the site to GitHub Pages. Previous academic-year snapshots stay available in the year menu. If Evergreen changes its HTML layout, the refresh fails before replacing the existing snapshot.

The site shows undergraduate offerings and published meeting times when available. Planning suggestions are heuristic; they are not admissions, registration, advising, or enrollment decisions. Always open the official listing to check current credits, prerequisites, location, schedule, fees, and space.

## Run locally

```sh
python3 -m http.server 8766
```

Open `http://localhost:8766/`. For a manual data refresh, install `requirements.txt` and run `python3 scripts/sync_catalog.py`. The front end is plain HTML, CSS, and JavaScript; it needs no build tools or JavaScript packages.

## Publishing

The repository's Pages source is GitHub Actions. `.github/workflows/refresh-and-deploy.yml` packages only site files and JSON snapshots, then publishes them on a push to `main`, a weekly schedule, or a manual run.
