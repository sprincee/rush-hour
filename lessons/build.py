"""Build the static Rush Hour site into dist/.

    python lessons/build.py              # Full site: dist/index.html plus one page per lesson
    python lessons/build.py --fragment   # Pages without <html>/<body>, for an Artifact preview

Lesson text comes from lessons/content/*.toml. The game code is web/src, fonts are
web/static/fonts, and the shop settings are shop/config.json, the same file the
cluster reads. Visual rules live in DESIGN_RH.md.
"""

import argparse
import logging
import shutil
import tomllib
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

logger = logging.getLogger("build")

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "lessons" / "content"
TEMPLATES = ROOT / "lessons" / "templates"
WEB_SRC = ROOT / "web" / "src"
FONTS = ROOT / "web" / "static" / "fonts"
SHOP_CONFIG = ROOT / "shop" / "config.json"


def load_toml(path: Path) -> dict:
    with path.open("rb") as f:
        return tomllib.load(f)


def copy_assets(out: Path) -> None:
    """Game modules, stylesheets, fonts and their licenses, and the shared shop settings."""
    assets = out / "assets"
    shutil.copytree(WEB_SRC, assets / "js", ignore=shutil.ignore_patterns("styles"))
    shutil.copytree(WEB_SRC / "styles", assets / "css")
    shutil.copytree(FONTS, assets / "fonts")
    shutil.copy2(SHOP_CONFIG, assets / "shop-config.json")


def load_course() -> tuple[dict, dict[str, dict]]:
    """The course, with each playable lesson joined to its own content file."""
    course = load_toml(CONTENT / "course.toml")
    lessons = {}
    for path in sorted(CONTENT.glob("lesson-*.toml")):
        lesson = load_toml(path)
        if not (WEB_SRC / "lessons" / lesson["module"]).exists():
            raise FileNotFoundError(f"{path.name}: web/src/lessons/{lesson['module']} doesn't exist")
        lessons[lesson["slug"]] = lesson

    for group in course["groups"]:
        group["playable"], group["soon"] = [], []
        for entry in group["lessons"]:
            page = entry.get("page")
            if page:
                if page not in lessons:
                    raise ValueError(f"course.toml links {page!r}, but no lesson file has that slug")
                lesson = lessons[page]
                entry.update(heading=lesson["heading"], levels=lesson["levels"])
                lesson.update(number=entry["number"], concept=entry["concept"], coffee=entry["coffee"])
                group["playable"].append(entry)
            else:
                group["soon"].append(entry)
    linked = {e.get("page") for g in course["groups"] for e in g["lessons"]}
    for slug in lessons:
        if slug not in linked:
            raise ValueError(f"lesson {slug!r} isn't linked from course.toml")
    return course, lessons


def build(out: Path, fragment: bool) -> list[Path]:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    copy_assets(out)

    env = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=select_autoescape(["html", "j2"]),
        undefined=StrictUndefined,  # A typo in a template variable fails the build.
        trim_blocks=True,
        lstrip_blocks=True,
    )
    course, lessons = load_course()
    playable = [e for g in course["groups"] for e in g["playable"]]
    shared = {
        "course": course,
        "fragment": fragment,
        "first_lesson": playable[0]["page"],
    }
    written = []

    def render(template: str, filename: str, page: str, **context) -> None:
        """`page` marks the current nav link (home, menu, about, lesson)."""
        path = out / filename
        path.write_text(env.get_template(template).render(**shared, page=page, **context), encoding="utf-8")
        written.append(path)

    total_levels = sum(e["levels"] for e in playable)
    render("index.html.j2", "index.html", "home", playable=playable, total_levels=total_levels)
    render("menu.html.j2", "menu.html", "menu", playable=playable)
    render("about.html.j2", "about.html", "about")
    render("survey.html.j2", "survey.html", "survey")

    for i, entry in enumerate(playable):
        lesson = lessons[entry["page"]]
        next_entry = playable[i + 1] if i + 1 < len(playable) else None
        render("lesson.html.j2", f"{lesson['slug']}.html", "lesson", lesson=lesson, next=next_entry)

    return written


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=ROOT / "dist", help="output folder (default: dist/)")
    parser.add_argument("--fragment", action="store_true", help="leave out <html>/<body>, for an Artifact preview")
    args = parser.parse_args()

    for page in build(args.out.resolve(), args.fragment):
        logger.info("Wrote %s", page.relative_to(args.out.resolve()))


if __name__ == "__main__":
    main()
