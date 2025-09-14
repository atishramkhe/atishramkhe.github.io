import json
import os
from PIL import Image
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'/usr/bin/tesseract'

MANIFEST_PATH = "logo_manifest.json"
LOGO_DIR = "."
SUPPORTED_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".ico")

def has_text_in_image(image_path):
    try:
        img = Image.open(image_path)
        # Convert .ico to PNG for OCR compatibility
        if image_path.lower().endswith('.ico'):
            img = img.convert('RGBA')
            with Image.new('RGBA', img.size, (255, 255, 255, 0)) as bg:
                bg.paste(img, (0, 0), img)
                img = bg.convert('RGB')
        else:
            img = img.convert('RGB')
        text = pytesseract.image_to_string(img)
        return bool(text.strip())
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return False

def main():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    updated = False
    for key, entry in manifest.items():
        filename = entry.get("filename")
        if not filename or not filename.lower().endswith(SUPPORTED_EXTS):
            continue
        img_path = os.path.join(LOGO_DIR, filename)
        if not os.path.isfile(img_path):
            print(f"Missing: {img_path}")
            continue

        # If .ico, convert to .png and update manifest
        if filename.lower().endswith('.ico'):
            png_filename = os.path.splitext(filename)[0] + '.png'
            png_path = os.path.join(LOGO_DIR, png_filename)
            try:
                img = Image.open(img_path)
                img.save(png_path, format='PNG')
                entry['filename'] = png_filename
                img_path = png_path
                updated = True
            except Exception as e:
                print(f"Error converting {img_path} to PNG: {e}")
                continue

        has_text = has_text_in_image(img_path)
        if has_text:
            if entry.get("has_text") != True:
                entry["has_text"] = True
                updated = True
        else:
            if entry.get("has_text"):
                entry.pop("has_text")
                updated = True

    if updated:
        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print("Manifest updated with has_text property and PNG conversions.")
    else:
        print("No changes made to manifest.")

if __name__ == "__main__":
    main()
