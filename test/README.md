# Test Portfolio (GitHub Pages static)

This folder is a static portfolio website designed so the artist can add new projects **without touching HTML**.

## Add a new project

Create a new folder in `travaux/` with this format:

```
X. PROJECT_NAME/
  banner.png
  home.png
  info.txt
  1.png
  2.mp4
  ...
```

- `X` is the project number (used for ordering)
- `banner.png` is used for the project page top banner
- `home.png` is used as the project thumbnail on the homepage
- `info.txt` uses sections:
  - `=title=` ... `==`
  - `=main_body=` ... `==`
  - `=infos=` ... `==`

## Regenerate the index

Run:

`python3 ./tools/generate_projects_json.py`

This creates/updates `travaux/projects.json`.

## Local preview

From this folder:

`python3 -m http.server 5173`

Then open `http://127.0.0.1:5173/`.
