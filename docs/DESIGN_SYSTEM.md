# Design system

Editorial cream/forest theme, serif headings, quiet geometric shoot placeholders and neutral surfaces. Tokens in apps/web/app/globals.css define backgrounds, surfaces, text, muted copy, borders, accent and errors. Tailwind v4 is installed via PostCSS; semantic CSS component classes share these tokens.

Controls have 46px minimum height, visible focus outlines, explicit labels and inline/summary errors. Skip navigation targets main. Live save status announces updates. Reduced-motion preferences disable skeleton animation. Dark mode follows system preference. Cards use a three/two/one-column grid; wizard summary moves below on tablet and is hidden at phone widths. Navigation stays short and tap-safe. Browser tests assert no horizontal overflow at 375/768/1280/1440px; manual screen-reader and full WCAG audit remain pilot gates.
