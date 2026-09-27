# Evergreen Course Mapper

An independent, shareable course planner for [The Evergreen State College](https://www.evergreen.edu/). Students can describe possible careers, core academic interests, other pursuits, fields they would rather avoid, and prior classes in their own words. Disliked fields lower a course's ranking without hiding it. A button below the goals opens Explore Courses with the best matches first, while rankings continue to update as answers change. Eight suggested themes fill a fall/winter/spring draft; students can remove a course to see alternatives ranked by remaining credits and interests, or browse and combine offerings at any published credit value. The year plan sits above the course catalog in a single scrolling flow; desktop layouts show the three quarters and catalog offerings in compact grids. Explore Courses can filter by any credit value offered in the catalog, including courses with multiple options. A final review checks the draft for published meeting conflicts, credit totals, quarter availability, standing, and entry details while flagging information that still needs confirmation. A “Not for me” action excludes unwanted courses from the current catalog year's browse results, draft, and suggestions, with a restore list. The credit target guides suggestions but does not restrict browsing or manual choices. The browser saves choices, draft plans, and exclusions in first-party cookies. No account or analytics service is used.

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
