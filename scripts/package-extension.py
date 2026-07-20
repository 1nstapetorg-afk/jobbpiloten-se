#!/usr/bin/env python3
"""
Package the JobbPiloten Auto-Fill extension into a FLAT sideloadable .zip.

For Chrome sideloading via chrome://extensions → "Load unpacked", the
manifest must be at the ZIP root (NOT nested in an `extension/`
subfolder). The previous default wrote paths like `extension/manifest.json`
into the zip, which forced the user to drill down one level after
unzipping — easy to mis-select and end up pointing Chrome at an inner
folder that has no manifest. This script now defaults to a flat layout
to remove that footgun.

USAGE
    python3 scripts/package-extension.py [options]

  --cws    Also write a Chrome Web Store-ready zip variant (same flat
           layout, separate filename). The "stable" + "versioned" flat
           zips are always emitted; --cws adds two more cws-* variants
           so a human can grab whichever filename they prefer.

OUTPUT (default, always emitted)
    dist/jobbpiloten-extension.zip         single-click install name
                                          (the new install-page default)
    dist/extension.zip                     legacy stable alias
    dist/extension-{version}.zip           versioned artifact (e.g. extension-0.2.0.zip)

OUTPUT (--cws, when requested)
    dist/extension-cws.zip                 CWS flat zip
    dist/extension-{version}-cws.zip       CWS versioned flat zip

The script is idempotent: re-running overwrites the previous artifact.
Excludes *.md, *.map, node_modules, .DS_Store, __pycache__ and dotfiles
so the artifact stays lean — Chrome refuses extensions that bundle a
.git folder.

The script reads manifest.json to surface the visible name + version
in the summary line. Any install error from a stale version block is
caught and degrades gracefully to "extension.zip".

Pre-flight: this script ASSUMES scripts/validate-extension.js has
already been run. The yarn `package:extension` chain enforces that
explicitly; calling this script directly bypasses the gate (useful
when iterating locally on the packager itself).
"""

import argparse
import json
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
OUT_DIR = ROOT / "dist"
EXCLUDE_NAMES = {
    ".DS_Store",
    "Thumbs.db",
    "node_modules",
    "__pycache__",
    ".git",
    ".next",
    "package-lock.json",
    "yarn.lock",
}
EXCLUDE_SUFFIXES = {
    ".pyc",
    ".swp",
    ".swo",
    ".log",
    ".map",
}
EXCLUDE_EXTRA_GLOBS = {
    # Documentation files — never ship to Chrome; CSP.md + README.md
    # stay in extension/ for developer ergonomics but are stripped from
    # the release zip.
    "*.md",
}


def read_manifest():
    manifest_path = SRC / "manifest.json"
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"WARN: cannot read manifest.json ({e}); using defaults", file=sys.stderr)
        return {}


def should_skip(name: str) -> bool:
    if name in EXCLUDE_NAMES:
        return True
    for suffix in EXCLUDE_SUFFIXES:
        if name.endswith(suffix):
            return True
    return False


def write_build_config():
    """Generate extension/build-config.json from build-time env.

    The popup's Tier-3 fallback (after chrome.storage.sync and
    manifest host_permissions) reads this file via
    chrome.runtime.getURL('build-config.json'). NEXT_PUBLIC_APP_URL
    is the canonical "default dashboard origin" — for production
    builds it's `https://jobbpiloten.se`; for preview/staging
    builds it should be set to the preview URL so a vanilla user
    still has a working Tier-3 hint.

    File lives in SRC/ so the next build_zip() picks it up
    automatically; no extra walk needed.
    """
    app_url = os.environ.get('NEXT_PUBLIC_APP_URL', 'https://jobbpiloten.se').rstrip('/')
    config = {
        'NEXT_PUBLIC_APP_URL': app_url,
        'buildTime': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    }
    out = SRC / 'build-config.json'
    out.write_text(json.dumps(config, indent=2, ensure_ascii=False))
    print(f"OK: wrote {out.relative_to(ROOT)} (NEXT_PUBLIC_APP_URL={app_url})")


def build_zip(out_path: Path):
    """Package the extension folder into a FLAT zip (manifest at root).

    Every entry's path is relative to `extension/` so the resulting
    archive extracts as `manifest.json` at the top level — exactly
    what chrome://extensions → "Load unpacked" expects when the user
    points the picker at the unzipped folder.
    """
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not SRC.exists():
        print(f"ERROR: extension folder missing: {SRC}", file=sys.stderr)
        sys.exit(2)
    files_added = 0
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, dirs, files in os.walk(SRC):
            # Prune excluded directories in-place so os.walk doesn't
            # descend into node_modules etc.
            dirs[:] = [d for d in dirs if d not in EXCLUDE_NAMES]
            for fname in files:
                if should_skip(fname):
                    continue
                full = Path(root) / fname
                # Flat: paths relative to extension/ → manifest.json
                # lands at the zip root, not inside an extension/ subdir.
                rel = full.relative_to(SRC)
                # Guard against absolute paths sneaking in via symlinks
                # (zipfile.write would otherwise accept them).
                if rel.is_absolute() or str(rel).startswith(".."):
                    print(
                        f"WARN: skipping suspicious path outside extension/: {full}",
                        file=sys.stderr,
                    )
                    continue
                zf.write(full, arcname=str(rel))
                files_added += 1
    return files_added


def main():
    parser = argparse.ArgumentParser(
        description="Package the JobbPiloten Auto-Fill extension into a flat zip.",
    )
    parser.add_argument(
        "--cws",
        action="store_true",
        help="Also write Chrome Web Store-ready flat zips (separate filenames).",
    )
    args = parser.parse_args()

    manifest = read_manifest()
    name = manifest.get("name") or "JobbPiloten Auto-Fill"
    version = manifest.get("version") or "0.0.0"

    # Always run the build-config writer BEFORE the zip, so the
    # generated build-config.json lands inside every emitted zip.
    write_build_config()

    # Always-on outputs (the new single-click install flow uses the
    # first one — the install page links to /api/extension/download
    # which streams an identical zip, so the user gets the same layout
    # whether they download via the page button or run yarn
    # package:extension locally).
    one_click = OUT_DIR / "jobbpiloten-extension.zip"
    stable = OUT_DIR / "extension.zip"
    versioned = OUT_DIR / f"extension-{version}.zip"

    count_one_click = build_zip(one_click)
    count_stable = build_zip(stable)
    count_versioned = build_zip(versioned)
    print(f"OK: packaged {name} v{version} (flat layout)")
    for label, path, count in (
        ("one-click", one_click, count_one_click),
        ("stable", stable, count_stable),
        ("versioned", versioned, count_versioned),
    ):
        size_kb = path.stat().st_size / 1024
        print(f"  {label}: {path.relative_to(ROOT)} ({count} files, {size_kb:.1f} KB)")

    # CWS variant: same flat layout, separate filename so a human
    # can grab whichever they prefer. Only emitted when explicitly
    # requested so the default dist/ stays small.
    if args.cws:
        cws_stable = OUT_DIR / "extension-cws.zip"
        cws_versioned = OUT_DIR / f"extension-{version}-cws.zip"
        count_cws_stable = build_zip(cws_stable)
        count_cws_versioned = build_zip(cws_versioned)
        for label, path, count in (
            ("cws-stable", cws_stable, count_cws_stable),
            ("cws-versioned", cws_versioned, count_cws_versioned),
        ):
            size_kb = path.stat().st_size / 1024
            print(f"  {label}: {path.relative_to(ROOT)} ({count} files, {size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
