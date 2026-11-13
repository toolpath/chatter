import { defineConfig } from 'vitepress';

// GitHub Pages serves the site at /<repo name>/. The deploy job sets DOCS_BASE,
// so the site keeps working when the repo gets a new name.
const base = process.env.DOCS_BASE ?? '/';

export default defineConfig({
  base,
  title: 'Chatter',
  description: 'See the live status of your CNC machines from any browser on your shop network.',
  // Always dark, like the Chatter app.
  appearance: 'force-dark',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/README.md'],
  // http://localhost:3001 and the like are correct links for the reader's own computer.
  ignoreDeadLinks: 'localhostLinks',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],

  themeConfig: {
    logo: { src: '/chatter-wordmark-dark.svg', alt: 'Chatter by Toolpath' },
    siteTitle: false,
    search: { provider: 'local' },
    outline: [2, 3],

    nav: [
      { text: 'Install', link: '/install/computer' },
      { text: 'Guide', link: '/guide/get-started' },
      { text: 'Hardware', link: '/hardware/case' },
      { text: 'Develop', link: '/develop/' },
      { text: 'API', link: '/api/' },
    ],

    sidebar: [
      {
        text: 'Install',
        items: [
          { text: 'Install on a computer', link: '/install/computer' },
          { text: 'Install on a Raspberry Pi', link: '/install/raspberry-pi' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Get started', link: '/guide/get-started' },
          { text: 'AI agent skills', link: '/guide/ai-agents' },
          { text: 'FANUC machines', link: '/guide/fanuc' },
          { text: 'Siemens machines', link: '/guide/siemens' },
          { text: 'Alerts', link: '/guide/alerts' },
          { text: 'Custom alert queries', link: '/guide/custom-alert-queries' },
          { text: 'Notifications', link: '/guide/notifications' },
          { text: 'Update Chatter', link: '/guide/update' },
          { text: 'Server logs', link: '/guide/logs' },
          { text: 'Use HTTPS', link: '/guide/https' },
          { text: 'Security', link: '/security' },
        ],
      },
      {
        text: 'Hardware',
        items: [{ text: '3D printed case', link: '/hardware/case' }],
      },
      {
        text: 'Develop',
        items: [
          { text: 'Run from source', link: '/develop/' },
          { text: 'Fake machines', link: '/develop/fake-machines' },
          { text: 'Pi card image', link: '/develop/pi-image' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api/' },
          { text: 'Login and settings', link: '/api/auth-and-settings' },
          { text: 'Machines and files', link: '/api/machines' },
          { text: 'History and alerts', link: '/api/history' },
          { text: 'Notifications', link: '/api/notifications' },
          { text: 'FANUC library and updates', link: '/api/admin' },
          { text: 'Live events', link: '/api/live-events' },
        ],
      },
    ],

    footer: { message: 'Released under the MIT License.' },
  },
});
