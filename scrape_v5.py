import json
import requests
from bs4 import BeautifulSoup, NavigableString
import time
import re
from urllib.parse import urljoin

# --- Configuration ---
BASE_URL = "https://fmhy.net/"
JSON_OUTPUT_FILE = "links.v5.json"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}
SOCIAL_DOMAINS = ['discord.gg', 'discord.com', 't.me', 'telegram.me', 'github.com', 'reddit.com', 'x.com', 'twitter.com']

# --- Helper Functions ---

def get_html_content(url, cache={}):
    """Fetches HTML content from a URL, using a cache to avoid redundant requests."""
    if url in cache:
        return cache[url]
    try:
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        html_content = response.text
        cache[url] = html_content
        time.sleep(0.5) # Be a good citizen
        return html_content
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Could not fetch {url}. Reason: {e}")
        return None

def find_next_ul(start_tag):
    """Finds the next <ul> tag that is a sibling of the start_tag."""
    if not start_tag:
        return None
    for sibling in start_tag.find_next_siblings():
        if sibling.name == 'ul':
            return sibling
        if sibling.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            break
    return None

def parse_list_item(li_tag):
    """
    Parses a single <li> tag to extract the main site and its mirrors/related links as separate items.
    """
    if not li_tag:
        return []

    all_links = li_tag.find_all('a')
    if not all_links:
        return []

    main_link_tag = all_links[0]
    main_url = main_link_tag.get('href')
    main_name = main_link_tag.get_text(strip=True)

    if not (main_url and main_url.startswith('http')):
        return []

    # The list of sites to be returned
    sites = [{
        'name': main_name,
        'url': main_url,
    }]

    # Process other links to find mirrors and related links
    for link_tag in all_links[1:]:
        url = link_tag.get('href')
        name = link_tag.get_text(strip=True)

        if not (url and url.startswith('http')):
            continue
        
        # Ignore social links
        is_social = any(domain in url for domain in SOCIAL_DOMAINS)
        if is_social:
            continue

        # Create a new entry for the mirror/related link
        new_name = f"{main_name} {name}"
        sites.append({
            'name': new_name,
            'url': url
        })

    return sites

# --- Main Logic ---

def main():
    print("Starting the comprehensive scraping process (v5) - Cleaning sub-section names...")
    
    # Load existing data from the JSON file
    try:
        with open(JSON_OUTPUT_FILE, 'r') as f:
            all_scraped_data = json.load(f)
        print(f"Successfully loaded existing data from {JSON_OUTPUT_FILE}")
    except (FileNotFoundError, json.JSONDecodeError):
        all_scraped_data = {}
        print(f"No existing data found or file is invalid. Starting with an empty dataset.")

    html_cache = {}

    # Manually define the main section URLs based on fmhy.net's sidebar
    section_urls = [
        urljoin(BASE_URL, '/privacy'),
        urljoin(BASE_URL, '/ai'),
        urljoin(BASE_URL, '/video'),
        urljoin(BASE_URL, '/audio'),
        urljoin(BASE_URL, '/gaming'),
        urljoin(BASE_URL, '/reading'),
        urljoin(BASE_URL, '/downloading'),
        urljoin(BASE_URL, '/torrenting'),
        urljoin(BASE_URL, '/educational'),
        urljoin(BASE_URL, '/mobile'),
        urljoin(BASE_URL, '/linux-macos'),
        urljoin(BASE_URL, '/non-english'),
        urljoin(BASE_URL, '/misc'),
    ]
    print(f"Will scrape {len(section_urls)} predefined section URLs.")

    for section_url in section_urls:
        top_level_section_id = section_url.replace(BASE_URL, '').strip('/').replace('/', '-')
        if not top_level_section_id:
            top_level_section_id = 'home'

        print(f"Scraping top-level section: '{top_level_section_id}' from {section_url}")
        section_html = get_html_content(section_url, html_cache)
        if not section_html:
            print(f"Skipping section '{top_level_section_id}' due to fetch error.")
            continue

        soup = BeautifulSoup(section_html, 'html.parser')
        
        current_top_level_data = all_scraped_data.get(top_level_section_id, {})
        current_language = None

        potential_headers = soup.find_all(['h2', 'h3', 'h4'])
        
        for header_tag in potential_headers:
            sub_section_name = header_tag.get_text(strip=True).replace('​', '')
            if not sub_section_name:
                continue

            ul_tag = find_next_ul(header_tag)
            if ul_tag:
                sub_section_links = []
                for li in ul_tag.find_all('li', recursive=False):
                    parsed_data_list = parse_list_item(li)
                    if parsed_data_list:
                        sub_section_links.extend(parsed_data_list)
                
                if sub_section_links:
                    if top_level_section_id == 'non-english':
                        common_english_categories = ["Downloading", "Torrenting", "Streaming", "Reading", "Free w/ Ads", "GFW Bypass", "Light Novels", "Manga"]
                        is_likely_category = any(sub_section_name.startswith(cat) for cat in common_english_categories)

                        if not is_likely_category:
                            display_name = sub_section_name.split('/')[0].strip()
                            if sub_section_name in ["Wiki", "Tools", "More", "Other Languages"]:
                                current_language = None
                                if display_name not in current_top_level_data:
                                    current_top_level_data[display_name] = []
                                existing_urls = {link['url'] for link in current_top_level_data[display_name]}
                                for link in sub_section_links:
                                    if link['url'] not in existing_urls:
                                        current_top_level_data[display_name].append(link)
                                print(f"  Added/updated general sub-section: {display_name}")
                            else:
                                current_language = display_name
                                if current_language not in current_top_level_data:
                                    current_top_level_data[current_language] = {}
                                print(f"  Detected new language section: {current_language}")
                        elif current_language:
                            category_name = sub_section_name.split('/')[0].strip()
                            if category_name not in current_top_level_data.get(current_language, {}):
                                current_top_level_data[current_language][category_name] = []
                            existing_urls = {link['url'] for link in current_top_level_data[current_language][category_name]}
                            for link in sub_section_links:
                                if link['url'] not in existing_urls:
                                    current_top_level_data[current_language][category_name].append(link)
                            print(f"    Added/updated category '{category_name}' under '{current_language}'.")
                        else:
                            category_name = sub_section_name.split('/')[0].strip()
                            if category_name not in current_top_level_data:
                                current_top_level_data[category_name] = []
                            existing_urls = {link['url'] for link in current_top_level_data[category_name]}
                            for link in sub_section_links:
                                if link['url'] not in existing_urls:
                                    current_top_level_data[category_name].append(link)
                            print(f"  Added/updated top-level category '{category_name}' in non-english (no active language).")
                    else:
                        if sub_section_name not in current_top_level_data:
                            current_top_level_data[sub_section_name] = []
                        existing_urls = {link['url'] for link in current_top_level_data[sub_section_name]}
                        new_links_added = 0
                        for link in sub_section_links:
                            if link['url'] not in existing_urls:
                                current_top_level_data[sub_section_name].append(link)
                                new_links_added += 1
                        print(f"  Found {len(sub_section_links)} links for sub-section '{sub_section_name}'. Added {new_links_added} new links.")

        if current_top_level_data:
            all_scraped_data[top_level_section_id] = current_top_level_data
        else:
            print(f"No sub-sections found for top-level section '{top_level_section_id}'.")

    # Write the final JSON file
    try:
        with open(JSON_OUTPUT_FILE, 'w') as f:
            json.dump(all_scraped_data, f, indent=4)
        print(f"\nSUCCESS: All data written to {JSON_OUTPUT_FILE}")
    except IOError as e:
        print(f"\nERROR: Could not write to file {JSON_OUTPUT_FILE}. Reason: {e}")

if __name__ == "__main__":
    main()
