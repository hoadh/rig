"""Tests for tailwind_config_gen.py (Tailwind v4 CSS theme generator)"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from tailwind_config_gen import (  # noqa: E402
    TailwindThemeGenerator,
    format_font_stack,
    main,
    parse_pairs,
)


class TestHelpers:
    def test_font_stack_quotes_multiword_names(self):
        assert format_font_stack("Playfair Display, serif") == '"Playfair Display", serif'

    def test_font_stack_strips_existing_quotes(self):
        assert format_font_stack("'Inter', system-ui") == "Inter, system-ui"

    def test_parse_pairs_keeps_colons_in_value(self):
        assert parse_pairs(["brand:oklch(62% 0.19 255)"], "colors") == {"brand": "oklch(62% 0.19 255)"}
        assert parse_pairs(["hero:url(https://x.y)"], "x") == {"hero": "url(https://x.y)"}

    @pytest.mark.parametrize("spec", ["brand", ":#fff", "brand:"])
    def test_parse_pairs_rejects_bad_specs(self, spec):
        with pytest.raises(ValueError):
            parse_pairs([spec], "colors")

    def test_parse_pairs_none(self):
        assert parse_pairs(None, "colors") == {}


class TestGenerator:
    @pytest.mark.parametrize("framework,path", [
        ("react", "src/index.css"), ("vue", "src/style.css"),
        ("svelte", "src/app.css"), ("nextjs", "app/globals.css"),
    ])
    def test_default_output_path(self, framework, path):
        assert TailwindThemeGenerator(framework).output_path == Path.cwd() / path

    def test_unknown_framework_falls_back_to_react(self):
        assert TailwindThemeGenerator("angular").output_path.name == "index.css"

    def test_minimal_css(self):
        css = TailwindThemeGenerator().generate_css()
        assert css.startswith('@import "tailwindcss";\n')
        assert "@custom-variant dark (&:where(.dark, .dark *));" in css
        assert "@theme" not in css
        assert "tailwind.config" not in css

    def test_media_dark_mode_omits_variant(self):
        assert "@custom-variant" not in TailwindThemeGenerator(dark_mode="media").generate_css()

    def test_theme_block(self):
        gen = TailwindThemeGenerator()
        gen.add_theme("color", {"brand": "#3b82f6"})
        gen.add_theme("font", {"display": "Playfair Display, serif"})
        gen.add_theme("spacing", {"navbar": "4rem"})
        gen.add_theme("breakpoint", {"3xl": "120rem"})
        gen.add_theme("radius", {"card": "0.75rem"})
        css = gen.generate_css()
        assert "@theme {\n" in css
        for line in ["--color-brand: #3b82f6;", '--font-display: "Playfair Display", serif;',
                     "--spacing-navbar: 4rem;", "--breakpoint-3xl: 120rem;", "--radius-card: 0.75rem;"]:
            assert f"  {line}\n" in css

    def test_unknown_namespace(self):
        with pytest.raises(ValueError):
            TailwindThemeGenerator().add_theme("shadow", {"x": "1px"})

    @pytest.mark.parametrize("name,value", [
        ("bad name", "#fff"), ("-x", "#fff"), ("brand\n", "#fff"), ("ok", "red; } body { x: y"),
        ("ok", "a\nb"), ("ok", "red /*"), ("ok", "a */"), ("ok", "a\\"),
    ])
    def test_rejects_css_injection(self, name, value):
        with pytest.raises(ValueError):
            TailwindThemeGenerator().add_theme("color", {name: value})

    def test_packages_split_into_import_and_plugin(self):
        gen = TailwindThemeGenerator()
        gen.add_packages(["tw-animate-css", "@tailwindcss/typography", "./my-plugin.js", "tw-animate-css"])
        css = gen.generate_css()
        assert css.count('@import "tw-animate-css";') == 1
        assert '@plugin "@tailwindcss/typography";' in css
        assert '@plugin "./my-plugin.js";' in css

    def test_rejects_quoted_package(self):
        with pytest.raises(ValueError):
            TailwindThemeGenerator().add_packages(['x"; @import "evil'])
        with pytest.raises(ValueError):
            TailwindThemeGenerator().add_packages(["pkg\\"])

    def test_sources(self):
        gen = TailwindThemeGenerator()
        gen.add_sources(["../packages/ui", "../packages/ui"])
        assert gen.generate_css().count('@source "../packages/ui";') == 1
        with pytest.raises(ValueError):
            gen.add_sources(['a"b'])

    def test_recommendations(self):
        assert TailwindThemeGenerator("react").recommend_packages() == ["tw-animate-css"]
        assert "@tailwindcss/typography" in TailwindThemeGenerator("nextjs").recommend_packages()

    def test_directive_order(self):
        gen = TailwindThemeGenerator()
        gen.add_packages(["tw-animate-css", "@tailwindcss/forms"])
        gen.add_sources(["../lib"])
        gen.add_theme("color", {"brand": "#000"})
        css = gen.generate_css()
        order = ['@import "tailwindcss"', '@import "tw-animate-css"', "@plugin", "@source",
                 "@custom-variant", "@theme"]
        positions = [css.index(token) for token in order]
        assert positions == sorted(positions)


class TestWrite:
    def test_write_creates_parent_dirs(self, tmp_path):
        out = tmp_path / "src" / "index.css"
        ok, msg = TailwindThemeGenerator(output_path=out).write()
        assert ok and out.read_text().startswith('@import "tailwindcss";')

    def test_write_refuses_existing_file(self, tmp_path):
        out = tmp_path / "app.css"
        out.write_text("/* mine */")
        ok, msg = TailwindThemeGenerator(output_path=out).write()
        assert not ok and "--force" in msg
        assert out.read_text() == "/* mine */"

    def test_write_force(self, tmp_path):
        out = tmp_path / "app.css"
        out.write_text("/* mine */")
        ok, _ = TailwindThemeGenerator(output_path=out).write(force=True)
        assert ok and "tailwindcss" in out.read_text()

    def test_write_os_error(self, tmp_path):
        blocker = tmp_path / "file"
        blocker.write_text("x")
        ok, msg = TailwindThemeGenerator(output_path=blocker / "a.css").write()
        assert not ok and "Failed" in msg


class TestCli:
    def test_print(self, capsys):
        code = main(["--framework", "nextjs", "--plugins", "--colors", "brand:oklch(62% 0.19 255)",
                     "--fonts", "display:Playfair Display,serif", "--print"])
        out = capsys.readouterr().out
        assert code == 0
        assert '@plugin "@tailwindcss/typography";' in out
        assert '@import "tw-animate-css";' in out
        assert "--color-brand: oklch(62% 0.19 255);" in out
        assert '--font-display: "Playfair Display", serif;' in out

    def test_explicit_plugins_skip_recommendations(self, capsys):
        main(["--plugins", "@tailwindcss/forms", "--print"])
        out = capsys.readouterr().out
        assert '@plugin "@tailwindcss/forms";' in out
        assert "tw-animate-css" not in out

    def test_write_and_install_hint(self, tmp_path, capsys):
        out = tmp_path / "app.css"
        assert main(["--output", str(out), "--plugins", "--spacing", "navbar:4rem"]) == 0
        assert "npm install -D tw-animate-css" in capsys.readouterr().out
        assert "--spacing-navbar: 4rem;" in out.read_text()

    def test_bad_spec_exit_code(self, capsys):
        assert main(["--colors", "brand", "--print"]) == 1
        assert "Invalid colors spec" in capsys.readouterr().err

    def test_existing_file_exit_code(self, tmp_path):
        out = tmp_path / "app.css"
        out.write_text("x")
        assert main(["--output", str(out)]) == 1
