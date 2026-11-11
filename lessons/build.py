"""Build the static Rush Hour site into dist/.

    python lessons/build.py              # Full site: dist/index.html plus one page per lesson
    python lessons/build.py --fragment   # Pages without <html>/<body>, for an Artifact preview

Lesson text comes from lessons/content/*.toml. The game code is web/src, and the
shop settings are shop/config.json, the same file the cluster reads.
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
SHOP_CONFIG = ROOT / "shop" / "config.json"


def load_toml(path: Path) -> dict:
    with path.open("rb") as f:
        return tomllib.load(f)


def copy_assets(out: Path) -> None:
    """Game modules, the stylesheet, and the shared shop settings."""
    assets = out / "assets"
    shutil.copytree(WEB_SRC, assets / "js", ignore=shutil.ignore_patterns("styles"))
    (assets / "css").mkdir(parents=True)
    shutil.copy2(WEB_SRC / "styles" / "lesson.css", assets / "css" / "lesson.css")
    shutil.copy2(SHOP_CONFIG, assets / "shop-config.json")


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
    written = []

    course = load_toml(CONTENT / "course.toml")
    playable = {lesson["page"] for g in course["groups"] for lesson in g["lessons"] if "page" in lesson}

    index = out / "index.html"
    index.write_text(env.get_template("index.html.j2").render(course=course, fragment=fragment), encoding="utf-8")
    written.append(index)

    for path in sorted(CONTENT.glob("lesson-*.toml")):
        lesson = load_toml(path)
        if lesson["slug"] not in playable:
            raise ValueError(f"{path.name}: slug {lesson['slug']!r} isn't linked from course.toml")
        if not (WEB_SRC / "lessons" / lesson["module"]).exists():
            raise FileNotFoundError(f"{path.name}: web/src/lessons/{lesson['module']} doesn't exist")
        page = out / f"{lesson['slug']}.html"
        page.write_text(env.get_template("lesson.html.j2").render(lesson=lesson, fragment=fragment), encoding="utf-8")
        written.append(page)

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
