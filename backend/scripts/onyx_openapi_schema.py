# export openapi schema without having to start the actual web server

# helpful tips: https://github.com/fastapi/fastapi/issues/1173

import argparse
import json

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from onyx.main import app as app_fn

# TODO: remove this once openapi fixes the anyof/none issues
OPENAPI_VERSION = "3.0.3"


def go(filename: str) -> None:
    with open(filename, "w") as f:
        raw_app = app_fn()
        # get_application() may return a socketio.ASGIApp wrapping the
        # FastAPI instance.  Unwrap if necessary.
        if isinstance(raw_app, FastAPI):
            app = raw_app
        else:
            app = getattr(raw_app, "other_asgi_app", raw_app)
            # The other_asgi_app may itself be a Starlette Mount; keep
            # unwrapping until we find the FastAPI instance.
            while not isinstance(app, FastAPI) and hasattr(app, "app"):
                app = app.app
        app.openapi_version = OPENAPI_VERSION
        json.dump(
            get_openapi(
                title=app.title,
                version=app.version,
                openapi_version=app.openapi_version,
                description=app.description,
                routes=app.routes,
            ),
            f,
        )

    print(f"Wrote OpenAPI schema to {filename}.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export OpenAPI schema for Onyx API (does not require starting API server)"
    )
    parser.add_argument(
        "--filename", "-f", help="Filename to write to", default="openapi.json"
    )

    args = parser.parse_args()
    go(args.filename)


if __name__ == "__main__":
    main()
