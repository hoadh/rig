# shadcn/ui Theming & Customization

Theme configuration, CSS variables, dark mode, and component customization.

## Dark Mode Setup

### Next.js App Router

**1. Install next-themes:**
```bash
npm install next-themes
```

**2. Create theme provider:**
```tsx
// components/theme-provider.tsx
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

**3. Wrap app:**
```tsx
// app/layout.tsx
import { ThemeProvider } from "@/components/theme-provider"

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

**4. Theme toggle component:**
```tsx
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
```

### Vite / Other Frameworks

Use similar approach with next-themes or implement custom solution:

```javascript
// Store preference
function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark')
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
}

// Initialize on load
if (localStorage.theme === 'dark' ||
    (!('theme' in localStorage) &&
     window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark')
}
```

## CSS Variable System (Tailwind v4)

shadcn/ui themes with CSS variables in `globals.css`. With Tailwind v4 there is no `tailwind.config.ts`: colors are plain `oklch()` values on `:root`/`.dark`, and `@theme inline` maps them to utilities (`bg-background`, `text-primary-foreground`, `border-border`, ...).

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

`npx shadcn@latest init` writes this file (plus chart and sidebar tokens). The full current set is in the shadcn/ui manual installation docs.

`&:is(.dark *)` is what `shadcn init` writes: it matches descendants of `.dark`, not the `.dark` element itself. `tailwind-customization.md` uses Tailwind's form `&:where(.dark, .dark *)`, which also matches the element and adds no specificity. Either works when `.dark` sits on `<html>`.

### Why `@theme inline`

`inline` makes utilities use the variable's value (`background-color: var(--background)`) instead of a theme variable that points to another variable. Without it, the `.dark` override would not reach the utilities.

### Color Format

Values are complete colors (`oklch(L C H)`), not bare HSL channels. Opacity modifiers work directly on the utility:
```html
<div class="bg-primary/50 border-border/60">...</div>
```
In custom CSS, use `var(--primary)` (no `hsl()` wrapper). For a translucent mix, use `color-mix(in oklch, var(--primary) 50%, transparent)`.

### Migrating from Tailwind v3 setups

| v3 (old) | v4 |
|---|---|
| `--primary: 222.2 47.4% 11.2%` in `@layer base` | `--primary: oklch(0.205 0 0)` on `:root` (outside `@layer`) |
| `hsl(var(--primary))` in `tailwind.config.ts` | `--color-primary: var(--primary)` in `@theme inline` |
| `darkMode: ["class"]` | `@custom-variant dark (&:is(.dark *));` |
| `tailwindcss-animate` plugin | `@import "tw-animate-css";` |
| `components.json` → `"config": "tailwind.config.ts"` | `"config": ""` |

## Color Customization

### Method 1: Update CSS Variables

Change colors by modifying CSS variables in `globals.css`:

```css
:root {
  --primary: oklch(0.606 0.25 292.717);  /* Violet */
  --primary-foreground: oklch(0.969 0.016 293.756);
}

.dark {
  --primary: oklch(0.541 0.281 293.009);
  --primary-foreground: oklch(0.969 0.016 293.756);
}
```

### Method 2: Add a New Token

Define the variable for both modes, then expose it in `@theme inline`:

```css
:root { --warning: oklch(0.84 0.16 84); --warning-foreground: oklch(0.28 0.07 46); }
.dark { --warning: oklch(0.41 0.11 46); --warning-foreground: oklch(0.99 0.02 95); }

@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

Now `bg-warning text-warning-foreground` works and switches with `.dark`.

### Method 3: Theme Generator

Use shadcn/ui theme generator: https://ui.shadcn.com/themes

Select base color, generate theme, copy CSS variables.

### Method 4: Multiple Themes

Create theme variants with data attributes:

```css
[data-theme="violet"] {
  --primary: oklch(0.606 0.25 292.717);
  --primary-foreground: oklch(0.969 0.016 293.756);
}

[data-theme="rose"] {
  --primary: oklch(0.645 0.246 16.439);
  --primary-foreground: oklch(0.969 0.015 12.422);
}
```

Apply theme:
```tsx
<div data-theme="violet">
  <Button>Violet theme</Button>
</div>
```

## Component Customization

Components live in your codebase - modify directly.

### Customize Variants

```tsx
// components/ui/button.tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-input bg-background",
        // Add custom variant
        gradient: "bg-linear-to-r from-purple-500 to-pink-500 text-white",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        // Add custom size
        xl: "h-14 rounded-md px-10 text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
```

Usage:
```tsx
<Button variant="gradient" size="xl">Custom Button</Button>
```

### Customize Styles

Modify base styles in component:

```tsx
// components/ui/card.tsx
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border bg-card text-card-foreground shadow-lg",  // Modified
      className
    )}
    {...props}
  />
))
```

### Override with className

Pass additional classes to override:

```tsx
<Card className="border-2 border-purple-500 shadow-2xl hover:scale-105 transition-transform">
  Custom styled card
</Card>
```

## Base Color Presets

shadcn/ui provides base color presets during `init`:

- **Slate**: Cool gray tones
- **Gray**: Neutral gray
- **Zinc**: Cool gray with a slight violet tint
- **Neutral**: Balanced gray
- **Stone**: Earthy gray

Select during setup or change later by updating CSS variables.

## Style Variants

Component style is set at `init` and stored in `components.json`. The old `default` style is deprecated; new projects use `new-york`. Keep `tailwind.config` empty for Tailwind v4:

```json
{
  "style": "new-york",
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  }
}
```

## Radius Customization

Control border radius globally with one variable:

```css
:root {
  --radius: 0.625rem;  /* Default */
  --radius: 0rem;      /* Sharp corners */
  --radius: 1rem;      /* Rounded */
}
```

`@theme inline` derives the scale from it (`--radius-lg: var(--radius)`, `--radius-sm: calc(var(--radius) * 0.6)`, ...), so `rounded-lg`, `rounded-md` and `rounded-sm` all follow `--radius`.

## Best Practices

1. **Use CSS Variables**: Enables runtime theme switching
2. **Consistent Foreground Colors**: Pair each color with appropriate foreground
3. **Test Both Themes**: Verify components in light and dark modes
4. **Semantic Naming**: Use `destructive` not `red`, `muted` not `gray`
5. **Accessibility**: Maintain sufficient color contrast (WCAG AA minimum)
6. **Component Overrides**: Use `className` prop for one-off customization
7. **Extract Patterns**: Create custom variants for repeated customizations
