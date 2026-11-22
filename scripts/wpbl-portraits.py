#!/usr/bin/env python3
"""List the league headshots we do not have yet, and import the ones named.

    npm run portraits                        # what is out of date
    npm run portraits -- ayuri-shimano 2089  # import, by our slug or the league's player id
    npm run portraits -- stale               # import everything out of date
    npm run portraits -- 2089 --preview      # the before and after sheet only, nothing written

    --face CX,CY,WIDTH   the face in the league file's pixels, when detection fails or is off
    --zoom 1.1           tighter (above 1) or looser (below 1) than the roster's usual framing
    --as SLUG            our player, when a new league record matches nobody by id or name
    --keep               record the league's photo as seen and keep ours

    Needs Pillow, numpy, opencv-python, fonttools and brotli, and the two VITE_SUPABASE_* values
    from .env to import (the share card names the player's club).

WHY THIS EXISTS. The portraits are bundled, so a photo the league replaces reaches the site only
when a person brings it over, and until Nov 22, 2026 that was a fresh one-off script each time:
Shimano's was cropped at the chin for three months. News Watch says when one changes
(`site-headshot`); this brings it over, with the thumb and share card that have to move with it.

SOURCES. scripts/wpbl-portrait-sources.json records which league media record each of our files
came from, so "out of date" is a comparison and not a memory of a Discord message. It is keyed by
the league's player id because the names differ ("Val Perez" there, Valerie Perez here, and a
typo in Esthela Segovia's).

A PERSON LOOKS BEFORE IT SHIPS. Nothing here commits. Detection is a 2001 face cascade and the
league's files vary, so every run writes a before and after sheet to share/portraits/ and every
doubt is printed beside the player. Read the sheet, then commit.

ALL OR NOTHING. Every player named is framed before any file is written, so a failure halfway
cannot leave a portrait, its thumb, its card and its source record disagreeing.
"""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PORTRAITS = ROOT / "src" / "wpbl" / "portraits"
SOURCES = ROOT / "scripts" / "wpbl-portrait-sources.json"
SHEETS = ROOT / "share" / "portraits"

HOST = "womensprobaseballleague.com"
WP = f"https://www.{HOST}/wp-json/wp/v2"
UA = "Mozilla/5.0 (portrait import)"

SIZE = 512
# The median face in the league's Aug 4, 2026 cut-outs as bundled, at 512: its center and width.
# New art is framed to it, so one face in a list is not bigger than the next.
FACE_X, FACE_Y, FACE_W = 257, 236, 218
# The least room above a cap or hair. The face rule alone cuts a tall cap.
HEADROOM = 22
# Three frontal cascades, and the median of what they find. Any one alone missed a face or
# boxed it half again too wide somewhere in the Oct 2026 batch; no two did on the same photo.
CASCADES = ("default", "alt", "alt2")


def sibling(filename: str):
    """One of the other portrait scripts, whose names have hyphens and so cannot be imported."""
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_"), ROOT / "scripts" / f"{filename}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ─── The league ─────────────────────────────────────────────────────────────


def fetch(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": UA}), timeout=90) as res:
        return res.read()


def field(raw):
    """An ACF value in either shape it has had: see acfValue in shared/newsWatch.js."""
    value = raw.get("value") if isinstance(raw, dict) and "value" in raw else raw
    if value in (None, "", False):
        return None
    if not isinstance(value, (str, int)):
        raise SystemExit(f"A league field changed shape: {raw!r}")
    return value


def league_players() -> dict:
    """Every league player with a headshot, by league id."""
    rows, page = [], 1
    while True:
        batch = json.loads(fetch(f"{WP}/wpbl_player?per_page=100&page={page}"
                                 "&_fields=id,title,acf.headshot,acf.stats_player_id"))
        rows += batch
        if len(batch) < 100:
            break
        page += 1

    shot = {str(r["id"]): field(r["acf"].get("headshot")) for r in rows}
    ids, media = sorted({int(v) for v in shot.values() if v}), {}
    if not ids:
        raise SystemExit("No league player has a headshot: the field moved.")
    for i in range(0, len(ids), 100):
        batch = ",".join(map(str, ids[i : i + 100]))
        for m in json.loads(fetch(f"{WP}/media?per_page=100&include={batch}&_fields=id,date,modified,source_url")):
            media[m["id"]] = m

    return {
        str(r["id"]): {
            "name": html.unescape(r["title"]["rendered"]),
            "stats_id": field(r["acf"].get("stats_player_id")),
            "media": media[int(shot[str(r["id"])])],
        }
        for r in rows
        if shot[str(r["id"])] and int(shot[str(r["id"])]) in media
    }


def download(url: str) -> Image.Image:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in (HOST, f"www.{HOST}"):
        raise SystemExit(f"Not a file on the league's site, so not downloaded: {url}")
    # Uploads keep their accents, and urllib takes only ASCII.
    safe = urlunsplit(parts._replace(path=quote(parts.path, safe="/%")))
    return ImageOps.exif_transpose(Image.open(BytesIO(fetch(safe))))


# ─── The picture ────────────────────────────────────────────────────────────


def cut_out(im: Image.Image, notes: list) -> Image.Image:
    rgba = im.convert("RGBA")
    a = np.array(rgba)
    if a[0, 0, 3] < 200 and a[0, -1, 3] < 200:
        return rgba
    keyer = sibling("cut-out-wpbl-portraits")
    if min(a[0, 0, :3].min(), a[0, -1, :3].min()) < keyer.HI:
        raise ValueError("the background is neither transparent nor white, so it needs a cut-out by hand")
    a[:, :, 3] = keyer.alpha(im)
    if a[:, :, 3].mean() < 25.5:
        raise ValueError("under a tenth of the frame survived the cut-out")
    notes.append("background keyed out, check the edges")
    return Image.fromarray(a, "RGBA")


def find_face(im: Image.Image, notes: list) -> tuple:
    """The face's center and width, in the image's pixels."""
    scale = min(1, 720 / max(im.size))
    small = im.resize((round(im.width * scale), round(im.height * scale)))
    flat = Image.new("RGBA", small.size, (128, 128, 128, 255))
    flat.alpha_composite(small)
    gray = cv2.cvtColor(np.array(flat.convert("RGB")), cv2.COLOR_RGB2GRAY)

    def detect(neighbors: int) -> list:
        found = []
        for name in CASCADES:
            cascade = cv2.CascadeClassifier(f"{cv2.data.haarcascades}haarcascade_frontalface_{name}.xml")
            # A logo on a jersey and a glove both pass for a face; neither is high and central.
            boxes = [
                (x + w / 2, y + h / 2, w)
                for x, y, w, h in cascade.detectMultiScale(gray, 1.03, neighbors, minSize=(40, 40))
                if y + h / 2 < small.height * 0.6 and 0.22 < (x + w / 2) / small.width < 0.78
            ]
            if boxes:
                found.append(max(boxes, key=lambda b: b[2]))
        return found

    found = detect(4)
    if not found:
        # A cap pulled low hides the brow the cascades want.
        found = detect(1)
        notes.append("face found only on a loose pass, check the framing")
    if not found:
        raise ValueError("no face found: pass --face CX,CY,WIDTH")

    face = np.median(found, axis=0)
    if sum(abs(w - face[2]) < face[2] * 0.15 for _, _, w in found) < 2:
        notes.append("the detectors disagree on the face, check the framing")
    return tuple(float(v / scale) for v in face)


def drop_shadow(im: Image.Image, notes: list) -> Image.Image:
    """Some league cut-outs carry a soft shadow in the alpha, a dirty halo on a club color."""
    a = np.array(im)
    alpha = a[:, :, 3]
    # A clean cut is faint on about 1% of the frame, its edge. A shadow was on over half.
    if ((alpha > 0) & (alpha < 100)).mean() < 0.10:
        return im
    r = max(1, round(im.width / 480))
    near = cv2.dilate((alpha > 215).astype(np.uint8), np.ones((2 * r + 1, 2 * r + 1), np.uint8))
    soft = cv2.GaussianBlur(near.astype(np.float32), (3, 3), 0)
    a[:, :, 3] = np.clip(alpha.astype(np.float32) * soft, 0, 255).astype(np.uint8)
    notes.append("drop shadow removed")
    return Image.fromarray(a, "RGBA")


def frame(im: Image.Image, face: tuple, zoom: float, notes: list) -> Image.Image:
    cx, cy, width = face
    side = SIZE * width / FACE_W / zoom
    solid = np.where((np.array(im)[:, :, 3] > 215).sum(axis=1) > 2)[0]
    if len(solid) == 0:
        raise ValueError("the file has no solid pixels")
    left = cx - FACE_X / SIZE * side
    top = min(cy - FACE_Y / SIZE * side, solid[0] - HEADROOM / SIZE * side)
    # A body has to run off the bottom of the frame, or it floats in the circle.
    top = min(top, im.height - side)

    crop = im.crop(tuple(round(v) for v in (left, top, left + side, top + side)))
    crop = drop_shadow(crop, notes)
    # The Aug 2026 files crop to 400-510 and look fine. Under three quarters of 512 it shows.
    if side < SIZE * 0.75:
        notes.append(f"upscaled from {round(side)}px, soft at full size")
    # A narrow file leaves a straight cut where the shoulders should leave the circle.
    seen = np.array(im)[max(0, round(top)) : max(1, round(top + side * 0.9)), :, 3] > 215
    if (left < 0 and seen[:, 0].any()) or (left + side > im.width and seen[:, -1].any()):
        notes.append("the file is narrower than the frame and shows a straight edge, try --zoom")
    if solid[0] - top > side * 0.35:
        notes.append("head sits low, try --zoom")
    return crop.resize((SIZE, SIZE), Image.LANCZOS)


def write_sheet(jobs: list, teams: dict) -> Path:
    cell, label = 256, 48
    out = Image.new("RGB", (cell * 2, (cell + label) * len(jobs)), "#23272e")
    draw = ImageDraw.Draw(out)
    for i, job in enumerate(jobs):
        y = i * (cell + label)
        mask = Image.new("L", (cell, cell), 0)
        ImageDraw.Draw(mask).ellipse((4, 4, cell - 4, cell - 4), fill=255)
        for n, art in enumerate((job["before"], job["after"])):
            face = Image.new("RGBA", (cell, cell), teams[job["row"]["team_id"]]["color"])
            if art:
                face.alpha_composite(art.resize((cell, cell), Image.LANCZOS))
            out.paste(face.convert("RGB"), (n * cell, y), mask)
        draw.text((8, y + cell + 6), f"{job['slug']}: before, after", fill="white")
        draw.text((8, y + cell + 24), "; ".join(job["notes"]), fill="#f2c94c")
    SHEETS.mkdir(parents=True, exist_ok=True)
    path = SHEETS / f"before-after-{datetime.now():%Y%m%d-%H%M%S}.jpg"
    out.save(path, quality=85)
    return path


# ─── Run ────────────────────────────────────────────────────────────────────


def source_of(slug: str, media: dict) -> dict:
    return {
        "slug": slug,
        "media": media["id"],
        "modified": media["modified"],
        "file": media["source_url"].split("/wp-content/uploads/")[-1],
    }


def out_of_date(league: dict, sources: dict) -> list:
    return [
        pid for pid, s in sources.items()
        if pid in league and (league[pid]["media"]["id"], league[pid]["media"]["modified"]) != (s["media"], s["modified"])
    ]


def match_new(player: dict, rows: list, slugify) -> str | None:
    """Our slug for a league record with no portrait yet: the stats id first, then the name."""
    for row in rows:
        if player["stats_id"] and player["stats_id"] in (row.get("api_ids") or []):
            return slugify(row["name"])
    slug = slugify(player["name"])
    return slug if any(slugify(row["name"]) == slug for row in rows) else None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="List or import the league's newer WPBL headshots.")
    ap.add_argument("players", nargs="*", help="our slugs, league player ids, or 'stale'")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--face")
    ap.add_argument("--zoom", type=float, default=1.0)
    ap.add_argument("--as", dest="as_slug")
    args = ap.parse_args()

    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    league = league_players()
    stale = out_of_date(league, sources)

    if not args.players:
        for pid in stale:
            media = league[pid]["media"]
            print(f"  {sources[pid]['slug']:<28} {pid:>6}  uploaded {media['date'][:10]}  {media['source_url']}")
        print(f"{len(stale)} of {len(sources)} portraits out of date."
              + (" Import with: npm run portraits -- stale" if stale else ""))
        others = [pid for pid in league if pid not in sources]
        if others:
            print(f"\n{len(others)} league players with a photo and no portrait here (import by id):")
            for pid in others:
                print(f"  {league[pid]['name']:<28} {pid:>6}")
        return

    by_slug = {s["slug"]: pid for pid, s in sources.items()}
    wanted = []
    for arg in args.players:
        for pid in stale if arg == "stale" else [by_slug.get(arg, arg)]:
            if pid not in league:
                raise SystemExit(f"{arg}: not one of our slugs or a league player id with a photo.")
            if pid not in wanted:
                wanted.append(pid)
    if not wanted:
        print("Nothing is out of date.")
        return
    if (args.face or args.as_slug) and len(wanted) > 1:
        raise SystemExit("--face and --as take one player at a time.")
    given_face = None
    if args.face:
        given_face = tuple(float(v) for v in args.face.split(","))
        if len(given_face) != 3:
            raise SystemExit("--face is CX,CY,WIDTH.")

    if args.keep:
        for pid in wanted:
            if pid not in sources:
                raise SystemExit(f"{pid}: there is no portrait of ours to keep.")
            sources[pid] = source_of(sources[pid]["slug"], league[pid]["media"])
        save_sources(sources)
        print(f"Kept ours for {len(wanted)}.")
        return

    cards = sibling("make-wpbl-share-cards")
    rows = cards.supabase("wpbl_players?select=name,position,team_id,api_ids")
    by_name = {}
    for row in rows:
        by_name.setdefault(cards.slugify(row["name"]), row)
    teams = cards.team_meta()

    jobs, failed = [], []
    for pid in wanted:
        player, notes = league[pid], []
        slug = sources[pid]["slug"] if pid in sources else args.as_slug or match_new(player, rows, cards.slugify)
        row = by_name.get(slug)
        if not row or row.get("team_id") not in teams:
            # Not a guess: the slug is how the app finds the file, and the card names the club.
            failed.append(f"{player['name']} ({pid}): no player with a club in our database, see --as")
            continue
        if pid not in sources and slug in by_slug:
            failed.append(f"{player['name']} ({pid}): {slug} already comes from league player {by_slug[slug]}")
            continue
        try:
            im = cut_out(download(player["media"]["source_url"]), notes)
            after = frame(im, given_face or find_face(im, notes), args.zoom, notes)
        except (ValueError, OSError) as err:
            failed.append(f"{slug} ({pid}): {err}")
            continue
        path = PORTRAITS / f"{slug}.webp"
        before = Image.open(path).convert("RGBA") if path.exists() else None
        jobs.append({"pid": pid, "slug": slug, "row": row, "before": before, "after": after, "notes": notes})

    for job in jobs:
        print(f"  {job['slug']:<28} {'; '.join(job['notes']) or 'ok'}")
    sheet = write_sheet(jobs, teams) if jobs else None
    if sheet:
        print(f"Before and after: {sheet}")
    if failed:
        raise SystemExit("Nothing written. Fix these or leave them out:\n  " + "\n  ".join(failed))
    if args.preview:
        print("Preview: nothing written.")
        return

    thumbs = sibling("make-wpbl-portrait-thumbs")
    face_font = cards.font_faces()
    for job in jobs:
        slug, row, team = job["slug"], job["row"], teams[job["row"]["team_id"]]
        path = PORTRAITS / f"{slug}.webp"
        job["after"].save(path, "WEBP", quality=82, method=6)
        thumbs.write_thumb(path, PORTRAITS / "thumbs" / path.name)
        cards.card(
            {"slug": slug, "name": row["name"], "position": row.get("position")},
            {**team, "full": f"{team['city']} {team['name']}"},
            face_font,
            cards.OUT / f"{slug}.webp",
        )
        sources[job["pid"]] = source_of(slug, league[job["pid"]]["media"])
    save_sources(sources)
    print(f"Wrote {len(jobs)}: portrait, thumb, share card and source. Look at the sheet before committing.")


def save_sources(sources: dict) -> None:
    # One player a line, sorted by slug, so a refresh reads as one changed line each.
    lines = [f'  "{pid}": {json.dumps(s)}' for pid, s in sorted(sources.items(), key=lambda kv: kv[1]["slug"])]
    SOURCES.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
