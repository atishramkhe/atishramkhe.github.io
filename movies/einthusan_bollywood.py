import json
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


BROWSE_URL = "https://einthusan.tv/movie/browse/?lang=hindi"
BASE_URL = "https://einthusan.tv"
REQUEST_TIMEOUT = 20
TARGET_SHOWCASED_SECTIONS = ("Most Watched", "Staff Picks", "Recently Added")
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}


def _extract_year(text):
    match = re.search(r"\b(?:19|20)\d{2}\b", text or "")
    return int(match.group(0)) if match else None


def _absolute_url(path):
    return urljoin(BASE_URL, path)


def _fetch_soup(session, url):
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def _merge_entry(entries, watch_url, section_name, browse_title=None, year=None):
    entry = entries.get(watch_url)
    if entry is None:
        entry = {
            "title": browse_title,
            "year": year,
            "einthusan_url": watch_url,
            "source_sections": [section_name],
        }
        entries[watch_url] = entry
        return

    if section_name not in entry["source_sections"]:
        entry["source_sections"].append(section_name)
    if not entry.get("title") and browse_title:
        entry["title"] = browse_title
    if not entry.get("year") and year:
        entry["year"] = year


def _parse_featured_entries(soup, entries):
    for panel in soup.select("#UIFeaturedFilms .tabbing > div.tabview"):
        link = panel.select_one(".block2 a.title[href*='/movie/watch/']")
        title_node = panel.select_one(".block2 a.title h2")
        info_node = panel.select_one(".block2 .info p")
        if link is None or title_node is None:
            continue

        watch_url = _absolute_url(link["href"])
        browse_title = title_node.get_text(" ", strip=True) or None
        year = _extract_year(info_node.get_text(" ", strip=True) if info_node else "")
        _merge_entry(entries, watch_url, "UIFeaturedFilms", browse_title=browse_title, year=year)


def _parse_showcased_entries(soup, entries):
    section = soup.select_one("#UIShowcasedFilms .tabbing")
    if section is None:
        return

    labels = [
        label.get_text(" ", strip=True)
        for label in section.select("ul label p")
    ]
    tabviews = section.select(":scope > div.tabview")
    for section_name, panel in zip(labels, tabviews):
        if section_name not in TARGET_SHOWCASED_SECTIONS:
            continue
        for link in panel.select("ul li a.title[href*='/movie/watch/']"):
            browse_title = link.get_text(" ", strip=True) or None
            watch_url = _absolute_url(link["href"])
            _merge_entry(entries, watch_url, section_name, browse_title=browse_title)


def _enrich_from_watch_page(session, entry):
    soup = _fetch_soup(session, entry["einthusan_url"])
    summary = soup.select_one("#UIMovieSummary")
    if summary is None:
        return entry

    title_node = summary.select_one(".block2 a.title h3")
    info_node = summary.select_one(".block2 .info p")
    if title_node is not None:
        entry["title"] = title_node.get_text(" ", strip=True) or entry.get("title")
    year = _extract_year(info_node.get_text(" ", strip=True) if info_node else "")
    if year:
        entry["year"] = year
    return entry


def scrape_bollywood_candidates():
    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)

    soup = _fetch_soup(session, BROWSE_URL)
    entries = {}
    _parse_featured_entries(soup, entries)
    _parse_showcased_entries(soup, entries)

    candidates = []
    for entry in entries.values():
        try:
            _enrich_from_watch_page(session, entry)
        except requests.RequestException as exc:
            print(f"[Bollywood] Failed to enrich {entry['einthusan_url']}: {exc}")
        if entry.get("title") and entry.get("year"):
            candidates.append(entry)
        else:
            print(
                "[Bollywood] Skipping incomplete Einthusan entry: "
                f"title={entry.get('title')!r}, year={entry.get('year')!r}, "
                f"url={entry['einthusan_url']}"
            )
    return candidates


def main():
    print(json.dumps(scrape_bollywood_candidates(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()