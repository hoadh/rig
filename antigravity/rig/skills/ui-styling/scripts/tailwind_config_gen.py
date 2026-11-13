#!/usr/bin/env python3
"""
Tailwind CSS v4 Theme Generator

Tailwind v4 is configured in CSS, not tailwind.config.js. This script generates
the CSS entry file: @import "tailwindcss", @plugin/@source directives, a
class-based dark variant, and an @theme block with colors, fonts, spacing,
breakpoints and radii (each theme variable creates matching utilities).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional

# Default CSS entry file per framework (matches the official starter templates)
DEFAULT_CSS_PATHS = {
    "react": "src/index.css",
    "vue": "src/style.css",
    "svelte": "src/app.css",
    "nextjs": "app/globals.css",
}

# CLI option -> @theme namespace (--color-brand creates bg-brand, text-brand, ...)
THEME_NAMESPACES = {
    "colors": "color",
    "fonts": "font",
    "spacing": "spacing",
    "breakpoints": "breakpoint",
    "radius": "radius",
}

# Packages shipped as plain CSS: loaded with @import, not @plugin
CSS_IMPORT_PACKAGES = {"tw-animate-css"}
GENERIC_FONTS = {"serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
                 "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math"}
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*")
UNSAFE_VALUE_RE = re.compile(r"[;{}\\\n\r]|/\*|\*/")  # would break out of the declaration/string


def format_font_stack(family: str) -> str:
    """'Playfair Display, serif' -> '"Playfair Display", serif' (generic names stay bare)."""
    parts = [f.strip().strip("'\"") for f in family.split(",") if f.strip()]
    return ", ".join(p if p in GENERIC_FONTS or " " not in p else f'"{p}"' for p in parts)


def parse_pairs(specs: Optional[List[str]], label: str) -> Dict[str, str]:
    """Parse NAME:VALUE specs; raise ValueError on bad input."""
    pairs: Dict[str, str] = {}
    for spec in specs or []:
        name, sep, value = spec.partition(":")
        name, value = name.strip(), value.strip()
        if not sep or not name or not value:
            raise ValueError(f"Invalid {label} spec: {spec!r} (expected NAME:VALUE)")
        pairs[name] = value
    return pairs


class TailwindThemeGenerator:
    """Build a Tailwind v4 CSS entry file."""

    def __init__(self, framework: str = "react", output_path: Optional[Path] = None,
                 dark_mode: str = "class"):
        self.framework = framework if framework in DEFAULT_CSS_PATHS else "react"
        self.output_path = output_path or Path.cwd() / DEFAULT_CSS_PATHS[self.framework]
        self.dark_mode = dark_mode
        self.theme: Dict[str, Dict[str, str]] = {ns: {} for ns in THEME_NAMESPACES.values()}
        self.imports: List[str] = []
        self.plugins: List[str] = []
        self.sources: List[str] = []

    def add_theme(self, namespace: str, values: Dict[str, str]) -> None:
        """Add theme variables to a namespace (color, font, spacing, breakpoint, radius)."""
        if namespace not in self.theme:
            raise ValueError(f"Unknown theme namespace: {namespace}")
        for name, value in values.items():
            if not NAME_RE.fullmatch(name):
                raise ValueError(f"Invalid {namespace} name: {name!r}")
            if UNSAFE_VALUE_RE.search(value):
                raise ValueError(f"Invalid {namespace} value for {name!r}: {value!r}")
            self.theme[namespace][name] = format_font_stack(value) if namespace == "font" else value

    def add_packages(self, packages: List[str]) -> None:
        """Register packages; CSS-only ones become @import, the rest @plugin."""
        for pkg in packages:
            if UNSAFE_VALUE_RE.search(pkg) or '"' in pkg:
                raise ValueError(f"Invalid package name: {pkg!r}")
            target = self.imports if pkg in CSS_IMPORT_PACKAGES else self.plugins
            if pkg not in target:
                target.append(pkg)

    def add_sources(self, paths: List[str]) -> None:
        """Extra paths for class detection (auto-detection skips .gitignore'd files)."""
        for path in paths:
            if UNSAFE_VALUE_RE.search(path) or '"' in path:
                raise ValueError(f"Invalid source path: {path!r}")
            if path not in self.sources:
                self.sources.append(path)

    def recommend_packages(self) -> List[str]:
        """tw-animate-css (shadcn/ui animations) everywhere; typography for Next.js content sites."""
        recommended = ["tw-animate-css"]
        if self.framework == "nextjs":
            recommended.append("@tailwindcss/typography")
        return recommended

    def generate_css(self) -> str:
        """Render the CSS entry file."""
        lines = ['@import "tailwindcss";']
        lines += [f'@import "{pkg}";' for pkg in self.imports]
        lines += [f'@plugin "{pkg}";' for pkg in self.plugins]
        lines += [f'@source "{path}";' for path in self.sources]
        if self.dark_mode == "class":
            lines += ["", "/* dark: utilities follow a .dark class instead of prefers-color-scheme */",
                      "@custom-variant dark (&:where(.dark, .dark *));"]
        theme_lines = [f"  --{ns}-{name}: {value};"
                       for ns, values in self.theme.items() for name, value in values.items()]
        if theme_lines:
            lines += ["", "@theme {", *theme_lines, "}"]
        return "\n".join(lines) + "\n"

    def write(self, force: bool = False) -> tuple[bool, str]:
        """Write the CSS file; refuse to overwrite an existing file unless force."""
        try:
            self.output_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                # mode "x" fails atomically if the file exists, so nothing is clobbered
                f = self.output_path.open("w" if force else "x", encoding="utf-8")
            except FileExistsError:
                return False, f"{self.output_path} exists; merge the output by hand or pass --force"
            with f:
                f.write(self.generate_css())
        except OSError as e:
            return False, f"Failed to write {self.output_path}: {e}"
        return True, f"Theme written to {self.output_path}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a Tailwind CSS v4 entry file (CSS-first config with @theme)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python tailwind_config_gen.py --framework nextjs --plugins --print
  python tailwind_config_gen.py --colors "brand:oklch(62% 0.19 255)" --fonts display:"Playfair Display,serif"
  python tailwind_config_gen.py --spacing navbar:4rem --breakpoints 3xl:120rem --radius card:0.75rem
  python tailwind_config_gen.py --plugins @tailwindcss/typography --source ../packages/ui""",
    )
    parser.add_argument("--framework", choices=sorted(DEFAULT_CSS_PATHS), default="react",
                        help="Target framework; picks the default output file (default: react)")
    parser.add_argument("--output", type=Path, help="Output CSS file path")
    for option, namespace in THEME_NAMESPACES.items():
        parser.add_argument(f"--{option}", nargs="*", metavar="NAME:VALUE",
                            help=f"Theme variables, written as --{namespace}-NAME")
    parser.add_argument("--plugins", nargs="*", metavar="PKG",
                        help="Packages to load; no value = recommended set")
    parser.add_argument("--source", nargs="*", metavar="PATH", help="Extra @source paths")
    parser.add_argument("--dark-mode", choices=["class", "media"], default="class",
                        help="class = .dark toggles dark: (default); media = OS setting")
    parser.add_argument("--print", action="store_true", help="Print CSS instead of writing")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing file")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    gen = TailwindThemeGenerator(args.framework, args.output, args.dark_mode)
    try:
        for option, namespace in THEME_NAMESPACES.items():
            gen.add_theme(namespace, parse_pairs(getattr(args, option), option))
        if args.plugins is not None:
            gen.add_packages(args.plugins or gen.recommend_packages())
        gen.add_sources(args.source or [])
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1

    if args.print:
        print(gen.generate_css(), end="")
        return 0
    ok, message = gen.write(args.force)
    print(message, file=sys.stdout if ok else sys.stderr)
    if ok and (gen.imports or gen.plugins):
        print(f"Install with: npm install -D {' '.join(gen.imports + gen.plugins)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
