import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://namelesscemetery.org',
  integrations: [
    sitemap({
      serialize(item) {
        item.lastmod = new Date().toISOString()
        return item
      },
    }),
  ],
  build: {
    format: 'directory',
  },
  server: { port: 4325 },
})
