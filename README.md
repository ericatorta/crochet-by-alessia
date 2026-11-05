# crochet by Alessia

Website of **crochet by Alessia**, handmade crochet bags, accessories and gifts from Turin — live at [crochetbyalessia.com](https://crochetbyalessia.com).

Static HTML/CSS/JS running as a Cloudflare Worker with static assets, plus a custom admin so Alessia can update everything on her own, from her phone.

## Features

- One-page site, pink + bordeaux like her business card, responsive (phone first)
- Works grouped in boxes (Bags, Accessories, Home, Custom) → categories → models with a photo gallery for each colour variant
- Craft markets section with a scrolling photo strip and upcoming events that expire automatically
- Reviews: visitors can leave one (honeypot + rate limit), Alessia approves it from the admin
- SEO: meta tags, Open Graph, sitemap, robots; self-hosted fonts
- **Admin** (`/admin/`): password login (PBKDF2 hash, signed session cookie), autosave on every change, undo, hourly backups with restore, multi-photo upload, move/replace/cover photos, hide models, edit boxes, categories, texts, contacts and events — content and photos stored in Cloudflare KV

## Structure

```
sito/              static site (index, admin/, fonts, photos, contenuti.json = starting content)
functions/         content API + admin auth (written as a Pages Function)
worker.js          adapts the function to a Worker with static assets
wrangler.jsonc     Cloudflare config (account and KV id are placeholders)
```

Secrets (`ADMIN_PASSWORD`, `SESSION_SECRET`) are set in Cloudflare, not in the code.

---

Design & development: [Erica Torta](https://github.com/ericatorta) · [lyto studio](https://lytostudio.com)

© 2026 crochet by Alessia — all rights reserved. Photos, logo and creations belong to Alessia.
