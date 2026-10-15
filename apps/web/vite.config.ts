import { defineConfig } from "vite"

// A pure static build: no server, no API routes. The dashboard talks to Tiramisu directly from
// the browser via the Arkiv SDK, the same way any other reader would. Deploy the `dist/` output
// to Vercel, GitHub Pages, Netlify, or any static host — see README.md "Deploying the dashboard".
export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
})
