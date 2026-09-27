#!/usr/bin/env python3
"""Refresh the static course snapshot from Evergreen's public catalog and timetable."""

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CATALOG = "https://www.evergreen.edu"
SCHEDULE = "https://schedule.evergreen.edu"
QUARTERS = ("Fall", "Winter", "Spring")
UNDERGRAD = {"Freshman", "Sophomore", "Junior", "Senior"}
HEADERS = {"User-Agent": "EvergreenCourseMap/1.0 (public catalog planning; https://github.com/ryness/evergreen-course-map)"}


def clean(value):
    return " ".join(value.split())


def fetch(url):
    for attempt in range(4):
        try:
            response = requests.get(url, headers=HEADERS, timeout=25)
            response.raise_for_status()
            return BeautifulSoup(response.text, "html.parser")
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(0.6 * (attempt + 1))


def parse_credits(text):
    return sorted({int(n) for n in re.findall(r"\b\d{1,2}\b", text) if 0 < int(n) <= 20})


def year_options(soup):
    select = soup.select_one("select#edit-year")
    if not select:
        raise RuntimeError("Evergreen's academic-year selector is missing")
    return [(int(o["value"]), o.get_text(" ", strip=True)) for o in select.select("option[value]") if o["value"].isdigit()]


def parse_index_row(row):
    cells = row.find_all("td", recursive=False)
    if len(cells) != 6:
        return None
    anchor = cells[0].select_one(".view--catalog__title a[href]")
    if not anchor:
        return None
    standings = [clean(li.get_text(" ", strip=True)) for li in cells[3].select("li")]
    if not UNDERGRAD.intersection(standings):
        return None
    url = urljoin(CATALOG, anchor["href"])
    title = clean(anchor.get_text(" ", strip=True))
    fields = list(dict.fromkeys(clean(el.get_text(" ", strip=True)) for el in cells[0].select(".view--catalog__field-of-study") if clean(el.get_text(" ", strip=True))))
    offerings = {}
    for box in cells[5].select(".quarter"):
        quarter_el = box.select_one(".quarter__title")
        year_el = box.select_one(".quarter__year")
        status_el = box.select_one(".quarter__offered")
        if not quarter_el or not year_el:
            continue
        quarter = clean(quarter_el.get_text(" ", strip=True))
        if quarter in QUARTERS:
            offerings[quarter] = {
                "year": clean(year_el.get_text(" ", strip=True)),
                "status": clean(status_el.get_text(" ", strip=True)) if status_el else "",
            }
    if not offerings:
        return None
    kind = clean(cells[2].get_text(" ", strip=True))
    time_offered = clean(cells[1].select_one(".catalog-course__time").get_text(" ", strip=True)) if cells[1].select_one(".catalog-course__time") else ""
    mode_text = clean(cells[1].get_text(" ", strip=True))
    modes = {}
    for quarter, code in (("Fall", "F"), ("Winter", "W"), ("Spring", "S")):
        m = re.search(r"(In Person|Hybrid|Remote)\s*\(" + code + r"\)", mode_text, re.I)
        if m:
            modes[quarter] = m.group(1).title().replace("In Person", "In person")
    if len(offerings) == 1 and not modes:
        m = re.search(r"In Person|Hybrid|Remote", mode_text, re.I)
        if m:
            modes[next(iter(offerings))] = m.group(0).title().replace("In Person", "In person")
    return {
        "id": hashlib.sha256(url.encode()).hexdigest()[:12],
        "title": title,
        "url": url,
        "type": kind,
        "fields": fields,
        "standings": standings,
        "credits": parse_credits(cells[4].get_text(" ", strip=True)),
        "timeOffered": time_offered,
        "modes": modes,
        "offerings": offerings,
    }


def read_index(year_id):
    first = fetch(f"{CATALOG}/catalog/index?year={year_id}")
    pager_links = [a.get("href", "") for a in first.select(".pager a")]
    pages = [int(n) for href in pager_links for n in re.findall(r"[?&]page=(\d+)", href)]
    last_page = max(pages, default=0)
    urls = [(i, f"{CATALOG}/catalog/index?year={year_id}&page={i}") for i in range(1, last_page + 1)]
    documents = [(0, first)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        documents.extend(pool.map(lambda x: (x[0], fetch(x[1])), urls))
    rows = {}
    for _, soup in sorted(documents):
        for row in soup.select("table.cols-6 tbody tr"):
            course = parse_index_row(row)
            if course:
                rows[course["id"]] = course
    if len(rows) < 100:
        raise RuntimeError(f"Only {len(rows)} undergraduate offerings found; refusing to replace the catalog")
    return list(rows.values())


def block_value(soup, label):
    for wrapper in soup.select(".eg-cat-entry__item-wrapper"):
        name = wrapper.select_one(".eg-cat-entry__label, .eg-cat-entry__label--inline")
        if name and clean(name.get_text(" ", strip=True)).rstrip(":").casefold() == label.casefold():
            item = wrapper.select_one(".eg-cat-entry__acad-details--item, .eg-cat-entry__reg-info--item, .eg-cat-entry__item")
            return clean(item.get_text(" ", strip=True)) if item else ""
    return ""


def minute(text):
    value = dt.datetime.strptime(text.strip(), "%I:%M %p")
    return value.hour * 60 + value.minute


def weeks(text):
    found = set()
    for part in text.replace(" ", "").split(","):
        if re.fullmatch(r"\d+-\d+", part):
            lo, hi = (int(x) for x in part.split("-"))
            found.update(range(lo, hi + 1))
        elif part.isdigit():
            found.add(int(part))
    return sorted(found) or None


def meeting_rows(soup):
    table = soup.select_one("#summary-block table")
    if not table:
        return []
    result = []
    for row in table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) < 4:
            continue
        activity, day, times, week_text = [clean(c.get_text(" ", strip=True)) for c in cells[:4]]
        if "optional" in activity.casefold():
            continue
        m = re.fullmatch(r"(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)", times, re.I)
        if not m or day not in {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}:
            continue
        result.append({"activity": activity, "day": day, "start": minute(m.group(1).upper()), "end": minute(m.group(2).upper()), "weeks": weeks(week_text)})
    return result


def enrich(course, year_label):
    soup = fetch(course["url"])
    main = soup.select_one("#main-content")
    if not main or not main.select_one(".eg-cat-entry__desc"):
        raise RuntimeError("Course detail structure missing: " + course["url"])
    paragraphs = [clean(p.get_text(" ", strip=True)) for p in main.select(".eg-cat-entry__desc .eg-body > p")]
    meaningful = [p for p in paragraphs if len(p) > 40 and not p.lower().startswith("anticipated credit")]
    course["description"] = " ".join(meaningful[:2])[:1100]
    location = main.select_one(".field--name-field-location-catalog .field__item")
    course["location"] = clean(location.get_text(" ", strip=True)) if location else ""
    course["fees"] = block_value(main, "Fees")
    course["prerequisites"] = block_value(main, "Prerequisites")
    schedule_anchor = main.select_one("a[href*='offering-schedule?event_id=']")
    if schedule_anchor:
        event_match = re.search(r"event_id=(\d+)", schedule_anchor["href"])
        if event_match:
            event = event_match.group(1)
            course["scheduleUrl"] = f"{SCHEDULE}/public/schedules/offering-schedule?event_id={event}"
            start_year = int(year_label.split("-")[0])
            course["meetings"] = {}
            for quarter in course["offerings"]:
                term = {"Fall": 10, "Winter": 20, "Spring": 30}[quarter]
                suffix = f"&term_code={start_year + 1}{term}" if len(course["offerings"]) > 1 else ""
                try:
                    course["meetings"][quarter] = meeting_rows(fetch(course["scheduleUrl"] + suffix))
                except (requests.RequestException, ValueError):
                    course["meetings"][quarter] = []
    return course


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", help="Catalog academic year, such as 2026-27; defaults to latest")
    parser.add_argument("--limit", type=int, help="Only for a local parser smoke test")
    args = parser.parse_args()
    home = fetch(f"{CATALOG}/catalog/index")
    options = year_options(home)
    year_id, year_label = next(((n, label) for n, label in options if label == args.year), max(options)) if args.year else max(options)
    print(f"Reading {year_label} catalog, year filter {year_id}", flush=True)
    courses = read_index(year_id)
    if args.limit:
        courses = courses[:args.limit]
    print(f"Found {len(courses)} undergraduate offerings; reading details and published meeting times", flush=True)
    failures = []
    enriched = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        jobs = {pool.submit(enrich, c, year_label): c for c in courses}
        for number, future in enumerate(concurrent.futures.as_completed(jobs), 1):
            course = jobs[future]
            try:
                enriched.append(future.result())
            except Exception as error:
                course["description"] = ""
                course["location"] = ""
                course["meetings"] = {}
                failures.append((course["title"], str(error)))
                enriched.append(course)
            if number % 50 == 0 or number == len(courses):
                print(f"Read {number}/{len(courses)}", flush=True)
    if len(failures) > max(8, len(courses) // 20):
        raise RuntimeError(f"Too many missing details ({len(failures)}); not publishing a partial refresh")
    enriched.sort(key=lambda c: (c["title"].casefold(), c["id"]))
    existing_path = ROOT / "data" / f"catalog-{year_label}.json"
    if existing_path.exists() and (ROOT / "data" / "manifest.json").exists():
        existing = json.loads(existing_path.read_text())
        if existing.get("courses") == enriched and existing.get("catalogUrl") == f"{CATALOG}/catalog/index?year={year_id}":
            print(f"No offering changes in {year_label}; keeping the existing snapshot", flush=True)
            return
    payload = {"academicYear": year_label, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "catalogUrl": f"{CATALOG}/catalog/index?year={year_id}", "courses": enriched}
    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    filename = f"catalog-{year_label}.json"
    (data_dir / filename).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"catalogs": []}
    manifest["catalogs"] = [item for item in manifest["catalogs"] if item["academicYear"] != year_label]
    manifest["catalogs"].append({"academicYear": year_label, "file": filename, "updatedAt": payload["updatedAt"], "count": len(enriched)})
    manifest["catalogs"].sort(key=lambda x: x["academicYear"], reverse=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    for title, error in failures[:8]:
        print(f"Warning: {title}: {error}", file=sys.stderr)
    print(f"Wrote {filename}: {len(enriched)} offerings, {len(failures)} detail failures", flush=True)


if __name__ == "__main__":
    main()
