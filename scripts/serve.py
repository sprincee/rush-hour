"""Serve dist/ locally with caching turned off, so a normal reload always shows the latest build.

    python scripts/serve.py [port]

Python's built-in http.server lets browsers keep old copies of the game's JavaScript
modules, so changes didn't show up until a hard reload. This adds `Cache-Control: no-store`.
For local development only; it binds to 127.0.0.1.
"""

import functools
import http.server
import logging
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / "dist"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCacheHandler, directory=str(DIST))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        logging.info("Serving %s at http://127.0.0.1:%d  (Ctrl+C to stop)", DIST, port)
        server.serve_forever()


if __name__ == "__main__":
    main()
