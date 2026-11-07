# Tailwind CSS Customization

CSS-first configuration (Tailwind v4): theme variables, custom utilities and variants, plugins, dark mode, content detection.

## @theme Directive

Modern approach to customize Tailwind using CSS:

```css
@import "tailwindcss";

@theme {
  /* Custom colors */
  --color-brand-50: oklch(0.97 0.02 264);
  --color-brand-500: oklch(0.55 0.22 264);
  --color-brand-900: oklch(0.25 0.15 264);

  /* Custom fonts */
  --font-display: "Satoshi", "Inter", sans-serif;
  --font-body: "Inter", system-ui, sans-serif;

  /* Custom spacing */
  --spacing-navbar: 4.5rem;

  /* Custom breakpoints */
  --breakpoint-3xl: 120rem;
  --breakpoint-tablet: 48rem;

  /* Custom shadows */
  --shadow-glow: 0 0 20px rgba(139, 92, 246, 0.3);

  /* Custom radius */
  --radius-large: 1.5rem;
}
```

**Usage:**
```html
<div class="bg-brand-500 font-display shadow-glow rounded-large">
  Custom themed element
</div>

<div class="tablet:grid-cols-2 3xl:grid-cols-6">
  Custom breakpoints
</div>
```

## Color Customization

### Custom Color Palette

```css
@theme {
  /* Full color scale */
  --color-primary-50: oklch(0.98 0.02 250);
  --color-primary-100: oklch(0.95 0.05 250);
  --color-primary-200: oklch(0.90 0.10 250);
  --color-primary-300: oklch(0.85 0.15 250);
  --color-primary-400: oklch(0.75 0.18 250);
  --color-primary-500: oklch(0.65 0.22 250);
  --color-primary-600: oklch(0.55 0.22 250);
  --color-primary-700: oklch(0.45 0.20 250);
  --color-primary-800: oklch(0.35 0.18 250);
  --color-primary-900: oklch(0.25 0.15 250);
  --color-primary-950: oklch(0.15 0.10 250);
}
```

### Semantic Colors

```css
@theme {
  --color-success: oklch(0.65 0.18 145);
  --color-warning: oklch(0.75 0.15 85);
  --color-error: oklch(0.60 0.22 25);
  --color-info: oklch(0.65 0.18 240);
}
```

```html
<div class="bg-success text-white">Success message</div>
<div class="border-error">Error state</div>
```

## Typography Customization

### Custom Fonts

```css
@theme {
  --font-sans: "Inter", system-ui, sans-serif;
  --font-serif: "Merriweather", Georgia, serif;
  --font-mono: "JetBrains Mono", Consolas, monospace;
  --font-display: "Playfair Display", serif;
}
```

```html
<h1 class="font-display">Display heading</h1>
<p class="font-sans">Body text</p>
<code class="font-mono">Code block</code>
```

### Custom Font Sizes

```css
@theme {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;
  --text-5xl: 3rem;
  --text-jumbo: 4rem;
}
```

## Spacing Customization

```css
@theme {
  /* Numeric steps (p-13, p-18, ...) come from --spacing automatically; only add named values */
  --spacing-header: 4rem;
  --spacing-footer: 3rem;
  --spacing-section: 6rem;
}
```

```html
<div class="p-18">18 × --spacing, no config needed</div>
<section class="py-section">Section spacing</section>
```

## Custom Utilities

Create reusable utility classes:

```css
@utility content-auto {
  content-visibility: auto;
}

@utility tab-* {
  tab-size: var(--tab-size-*);
}

@utility glass {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
```

**Usage:**
```html
<div class="content-auto">Optimized rendering</div>
<pre class="tab-4">Code with 4-space tabs</pre>
<div class="glass">Glassmorphism effect</div>
```

## Custom Variants

Create custom state variants:

```css
@custom-variant theme-midnight (&:where([data-theme="midnight"] *));
@custom-variant aria-checked (&[aria-checked="true"]);
@custom-variant required (&:required);
```

**Usage:**
```html
<div data-theme="midnight">
  <div class="theme-midnight:bg-navy-900">
    Applies in midnight theme
  </div>
</div>

<input class="required:border-red-500" required />
```

## Layer Organization

Organize CSS into layers. Classes defined in `@layer components` do not get variants (`hover:btn-primary` won't work); define them with `@utility` when they need `hover:`, `md:` or `dark:`.

```css
@layer base {
  h1 {
    @apply text-4xl font-bold tracking-tight;
  }

  h2 {
    @apply text-3xl font-semibold;
  }

  a {
    @apply text-blue-600 hover:text-blue-700 underline-offset-4 hover:underline;
  }

  body {
    @apply bg-background text-foreground antialiased;
  }
}

@layer components {
  .btn {
    @apply px-4 py-2 rounded-lg font-medium transition-colors;
  }

  .btn-primary {
    @apply bg-blue-600 text-white hover:bg-blue-700;
  }

  .btn-secondary {
    @apply bg-gray-200 text-gray-900 hover:bg-gray-300;
  }

  .card {
    @apply bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition-shadow;
  }

  .input {
    @apply w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent;
  }
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }

  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
}
```

## @apply Directive

Extract repeated utility patterns:

```css
.btn-primary {
  @apply bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 focus:outline-hidden focus:ring-4 focus:ring-blue-300;
}

.input-field {
  @apply w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed;
}

.section-container {
  @apply container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl;
}
```

**Usage:**
```html
<button class="btn-primary">Click me</button>
<input class="input-field" />
<div class="section-container">Content</div>
```

## Plugins

### Official Plugins

```bash
npm install -D @tailwindcss/typography @tailwindcss/forms
```

Load plugins in CSS with `@plugin` (no `require()`, no config file):

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
@plugin "@tailwindcss/forms";
```

Container queries are built into v4 (`@container`, `@sm:`, `@lg:`); `@tailwindcss/container-queries` is no longer needed.

**Typography plugin:**
```html
<article class="prose lg:prose-xl dark:prose-invert">
  <h1>Styled article</h1>
  <p>Automatically styled prose content</p>
</article>
```

**Forms plugin:**
```html
<!-- Automatically styled form elements -->
<input type="text" />
<select></select>
<textarea></textarea>
```

### Custom Plugin

Prefer CSS: most plugin use cases are now `@utility` and `@custom-variant` (see above).

```css
@utility text-shadow {
  text-shadow: 2px 2px 4px rgb(0 0 0 / 0.1);
}

@utility card-custom {
  background-color: var(--color-white);
  border-radius: var(--radius-lg);
  padding: --spacing(6);
  box-shadow: var(--shadow-md);
}
```

A JavaScript plugin still works, loaded by path:

```javascript
// my-plugin.js
import plugin from "tailwindcss/plugin"

export default plugin(function ({ addUtilities }) {
  addUtilities({
    ".text-shadow-lg": { textShadow: "4px 4px 8px rgb(0 0 0 / 0.2)" },
  })
})
```

```css
@plugin "./my-plugin.js";
```

## Configuration Examples

### Complete Theme (CSS-first)

v4 has no `tailwind.config.ts`. The whole configuration lives in the CSS entry file:

```css
/* app/globals.css */
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-brand-50: oklch(0.97 0.014 254.604);
  --color-brand-500: oklch(0.623 0.214 259.815);
  --color-brand-900: oklch(0.379 0.146 265.522);

  --font-sans: "Inter", system-ui, sans-serif;
  --font-display: "Playfair Display", serif;

  --spacing-navbar: 4.5rem;

  --animate-slide-in: slide-in 0.5s ease-out;

  @keyframes slide-in {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(0); }
  }
}

/* v4 container has no center/padding options: extend it with @utility */
@utility container {
  margin-inline: auto;
  padding-inline: 2rem;
}
```

Usage: `bg-brand-500`, `font-display`, `h-navbar`, `animate-slide-in`. For shadcn/ui color tokens (`@theme inline` + `:root`/`.dark` variables) see `shadcn-theming.md`.

Generate a starting file with `scripts/tailwind_config_gen.py`.

### Legacy JS Config

An existing v3 config can be loaded during migration with `@config "../tailwind.config.js";`. `corePlugins`, `safelist` and `separator` are not supported there. Prefer running `npx @tailwindcss/upgrade` to convert it to CSS.

## Dark Mode Configuration

By default `dark:` follows the OS setting (`prefers-color-scheme`); nothing to configure. To toggle with a `.dark` class instead:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Or with a data attribute: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`

**Usage:**
```html
<!-- Class-based -->
<html class="dark">
  <div class="bg-white dark:bg-gray-900">
    Responds to .dark class
  </div>
</html>

<!-- Default (media query) -->
<div class="bg-white dark:bg-gray-900">
  Responds to system preference automatically
</div>
```

## Content Detection

v4 finds class names automatically: it scans the project and skips `.gitignore`d files, binary files and CSS files. There is no `content` array. Add sources it would miss with `@source`, and exclude paths with `@source not`:

```css
@import "tailwindcss";
@source "../node_modules/@my-company/ui-lib";
@source not "./src/legacy";
```

### Safelist

Force classes that never appear literally in source files with `@source inline()` (supports brace expansion):

```css
@source inline("bg-red-500 bg-green-500 bg-blue-500");
@source inline("{hover:,}bg-{red,green,blue}-{100,500,900}");
```

Better: avoid building class names dynamically (`bg-${color}-500`); map to full class strings instead.

## Best Practices

1. **Use @theme for simple customizations**: Prefer CSS-based customization
2. **Extract components sparingly**: Use @apply only for truly repeated patterns
3. **Leverage design tokens**: Define custom tokens in @theme
4. **Layer organization**: Keep base, components, and utilities separate
5. **Plugin for complex logic**: Use plugins for advanced customizations
6. **Test dark mode**: Ensure custom colors work in both themes
7. **Document custom utilities**: Add comments explaining custom classes
8. **Semantic naming**: Use descriptive names (primary not blue)
