# Nameless Cemetery

Source code for [namelesscemetery.org](https://namelesscemetery.org), the website of the Nameless Cemetery Association in Travis County, Texas.

## About

Nameless Cemetery is a historic Texas cemetery with burials dating to 1882. The community of Nameless got its name after the U.S. Post Office rejected six proposed names and a frustrated resident wrote back: *"Let the post office be Nameless and be damned."*

The Nameless Cemetery Association was incorporated in 2009 to preserve and maintain the cemetery, the adjacent 1909 schoolhouse, and the relocated Gray homestead.

This site was built to replace an aging WordPress blog and give the association a modern, fast, mobile-friendly home on the web.

## Stack

- [Astro 5](https://astro.build/) (static site generation)
- Vanilla CSS (no framework)
- Deployed on [Cloudflare Pages](https://pages.cloudflare.com/)
- Email routing via Cloudflare Email Routing

## Design

Colors are pulled directly from the cemetery's wrought iron gate arch:

| Token | Hex | Use |
|-------|-----|-----|
| Iron | `#2E2A27` | Headers, deep accents |
| Patina | `#6B5E4F` | Body text |
| Limestone | `#F5F0E8` | Backgrounds |
| Live Oak | `#4D6B3F` | CTAs, links |

Typography: [Playfair Display](https://fonts.google.com/specimen/Playfair+Display) (headings) + [Source Sans 3](https://fonts.google.com/specimen/Source+Sans+3) (body).

Full design system: [BRAND.md](BRAND.md)

## Features

- Cinematic splash screen on first visit (sessionStorage skip on internal navigation)
- Scroll-reveal animations with `data-reveal` attribute system
- Counter-up ticker animation (requestAnimationFrame + ease-out cubic)
- Typewriter effect on the founding quote
- 12-photo flood carousel with swipe support
- Stories content collection (Astro content collections)
- Responsive museum-style photo framing
- Google Maps embed with GPS coordinates
- Structured data (JSON-LD) for Organization and Cemetery schemas
- Sitemap generation

## Development

```bash
npm install
npm run dev
```

Dev server runs on `localhost:4321`.

## Deploy

Deployed to Cloudflare Pages via Wrangler CLI:

```bash
npx astro build
npx wrangler pages deploy dist/ --project-name=nameless-cemetery --branch=main
```

## Credits

Site created and maintained by [Travis Bonnet](https://github.com/travisbonnet) and [Claude](https://www.anthropic.com/claude).

Built for the Nameless Cemetery Association. Est. 2009. Earliest burial: 1882.

## License

Source code is MIT licensed. Site content (text, images, stories) is copyright Nameless Cemetery Association and used with permission.
