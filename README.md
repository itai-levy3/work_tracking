# WorkTrack

Hours tracking web app built with React, TypeScript, and Vite.

## Local development

Requirements:

- Node.js 18+ (or newer LTS)
- npm

Run locally:

```sh
npm install
npm run dev
```

Build for production:

```sh
npm run build
npm run preview
```

## Tech stack

- Vite
- React
- TypeScript
- shadcn-ui
- Tailwind CSS

## Deployment (Netlify)

This project is configured for Netlify:

- Build command: `npm run build`
- Publish directory: `dist`

SPA redirects are defined in `netlify.toml`.

## PWA support

The app includes PWA setup via `vite-plugin-pwa`:

- Web app manifest
- Service worker
- Installable in supported mobile/desktop browsers
