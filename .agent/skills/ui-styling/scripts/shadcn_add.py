#!/usr/bin/env python3
"""
shadcn/ui Component Installer

Add shadcn/ui components to project with automatic dependency handling.
Wraps shadcn CLI for programmatic component installation.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

# shadcn component names: lowercase alphanumerics and hyphens only. Enforced before
# any subprocess call because on Windows npx resolves to npx.cmd, which CreateProcess
# runs through cmd.exe (shell metacharacters in argv would be interpreted).
COMPONENT_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def validate_component_names(components: List[str]) -> Optional[str]:
    """Return an error message if any component name is unsafe, else None."""
    invalid = [c for c in components if not COMPONENT_NAME_RE.fullmatch(c)]
    if invalid:
        return (
            f"Invalid component name(s): {', '.join(invalid)}. "
            "Use lowercase letters, digits and hyphens only"
        )
    return None


def resolve_npx() -> Optional[str]:
    """Resolve npx honoring PATHEXT (npx.cmd on Windows); None if not installed."""
    return shutil.which("npx")


class ShadcnInstaller:
    """Handle shadcn/ui component installation."""

    def __init__(self, project_root: Optional[Path] = None, dry_run: bool = False):
        """
        Initialize installer.

        Args:
            project_root: Project root directory (default: current directory)
            dry_run: If True, show actions without executing
        """
        self.project_root = project_root or Path.cwd()
        self.dry_run = dry_run
        self.components_json = self.project_root / "components.json"

    def check_shadcn_config(self) -> bool:
        """
        Check if shadcn is initialized in project.

        Returns:
            True if components.json exists
        """
        return self.components_json.exists()

    def get_installed_components(self) -> List[str]:
        """
        Get list of already installed components.

        Returns:
            List of installed component names
        """
        if not self.check_shadcn_config():
            return []

        try:
            with open(self.components_json) as f:
                config = json.load(f)

            components_dir = self.project_root / config.get("aliases", {}).get(
                "components", "components"
            ).replace("@/", "")
            ui_dir = components_dir / "ui"

            if not ui_dir.exists():
                return []

            return [f.stem for f in ui_dir.glob("*.tsx") if f.is_file()]
        except (json.JSONDecodeError, KeyError, OSError):
            return []

    def add_components(
        self, components: List[str], overwrite: bool = False
    ) -> tuple[bool, str]:
        """
        Add shadcn/ui components.

        Args:
            components: List of component names to add
            overwrite: If True, overwrite existing components

        Returns:
            Tuple of (success, message)
        """
        if not components:
            return False, "No components specified"

        name_error = validate_component_names(components)
        if name_error:
            return False, name_error

        if not self.check_shadcn_config():
            return (
                False,
                "shadcn not initialized. Run 'npx shadcn@latest init' first",
            )

        # Check which components already exist
        installed = self.get_installed_components()
        already_installed = [c for c in components if c in installed]

        if already_installed and not overwrite:
            return (
                False,
                f"Components already installed: {', '.join(already_installed)}. "
                "Use --overwrite to reinstall",
            )

        # Build command
        cmd = ["npx", "shadcn@latest", "add"] + components

        if overwrite:
            cmd.append("--overwrite")

        if self.dry_run:
            return True, f"Would run: {' '.join(cmd)}"

        # Execute command (argv[0] resolved via PATHEXT so Windows finds npx.cmd)
        npx = resolve_npx()
        if npx is None:
            return False, "npx not found. Ensure Node.js is installed"
        try:
            result = subprocess.run(
                [npx] + cmd[1:],
                cwd=self.project_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
            )

            success_msg = f"Successfully added components: {', '.join(components)}"
            if result.stdout:
                success_msg += f"\n\nOutput:\n{result.stdout}"

            return True, success_msg

        except subprocess.CalledProcessError as e:
            error_msg = f"Failed to add components: {e.stderr or e.stdout or str(e)}"
            return False, error_msg
        except FileNotFoundError:
            return False, "npx not found. Ensure Node.js is installed"

    def add_all_components(self, overwrite: bool = False) -> tuple[bool, str]:
        """
        Add all available shadcn/ui components.

        Args:
            overwrite: If True, overwrite existing components

        Returns:
            Tuple of (success, message)
        """
        if not self.check_shadcn_config():
            return (
                False,
                "shadcn not initialized. Run 'npx shadcn@latest init' first",
            )

        cmd = ["npx", "shadcn@latest", "add", "--all"]

        if overwrite:
            cmd.append("--overwrite")

        if self.dry_run:
            return True, f"Would run: {' '.join(cmd)}"

        npx = resolve_npx()
        if npx is None:
            return False, "npx not found. Ensure Node.js is installed"
        try:
            result = subprocess.run(
                [npx] + cmd[1:],
                cwd=self.project_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
            )

            success_msg = "Successfully added all components"
            if result.stdout:
                success_msg += f"\n\nOutput:\n{result.stdout}"

            return True, success_msg

        except subprocess.CalledProcessError as e:
            error_msg = f"Failed to add all components: {e.stderr or e.stdout or str(e)}"
            return False, error_msg
        except FileNotFoundError:
            return False, "npx not found. Ensure Node.js is installed"

    def list_installed(self) -> tuple[bool, str]:
        """
        List installed components.

        Returns:
            Tuple of (success, message with component list)
        """
        if not self.check_shadcn_config():
            return False, "shadcn not initialized"

        installed = self.get_installed_components()

        if not installed:
            return True, "No components installed"

        return True, f"Installed components:\n" + "\n".join(f"  - {c}" for c in sorted(installed))


def main():
    """CLI entry point."""
    # Piped stdout on Windows defaults to cp1252; never crash on non-ASCII output
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(
        description="Add shadcn/ui components to your project",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Add single component
  python shadcn_add.py button

  # Add multiple components
  python shadcn_add.py button card dialog

  # Add all components
  python shadcn_add.py --all

  # Overwrite existing components
  python shadcn_add.py button --overwrite

  # Dry run (show what would be done)
  python shadcn_add.py button card --dry-run

  # List installed components
  python shadcn_add.py --list
        """,
    )

    parser.add_argument(
        "components",
        nargs="*",
        help="Component names to add (e.g., button, card, dialog)",
    )

    parser.add_argument(
        "--all",
        action="store_true",
        help="Add all available components",
    )

    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing components",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without executing",
    )

    parser.add_argument(
        "--list",
        action="store_true",
        help="List installed components",
    )

    parser.add_argument(
        "--project-root",
        type=Path,
        help="Project root directory (default: current directory)",
    )

    args = parser.parse_args()

    # Initialize installer
    installer = ShadcnInstaller(
        project_root=args.project_root,
        dry_run=args.dry_run,
    )

    # Handle list command
    if args.list:
        success, message = installer.list_installed()
        print(message)
        sys.exit(0 if success else 1)

    # Handle add all command
    if args.all:
        success, message = installer.add_all_components(overwrite=args.overwrite)
        print(message)
        sys.exit(0 if success else 1)

    # Handle add specific components
    if not args.components:
        parser.print_help()
        sys.exit(1)

    success, message = installer.add_components(
        args.components,
        overwrite=args.overwrite,
    )

    print(message)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
