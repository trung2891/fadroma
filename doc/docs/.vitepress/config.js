export default {
  lang:        'en-US',
  title:       'Fadroma',
  description: 'Fadroma Guide',
  lastUpdated: true,
  themeConfig: {
    sidebar: [
      {
        text: "Welcome to Fadroma",
        collapsible: false,
        items: [
          { text: "Overview",          link: "/" },
          { text: "Project setup",     link: "/project-setup" },
          { text: "Contributing to Fadroma", link: "/contributing" },
        ]
      }, {
        text: "Rust",
        collapsible: false,
        items: [
          { text: "Prelude: Writing contracts",  link: "/writing-contracts" },
          { text: "Derive: Advanced contracts",  link: "/writing-contracts-with-derive" },
          { text: "Ensemble: Testing contracts", link: "/testing-contracts" },
        ]
      }, {
        text: "TypeScript",
        collapsible: false,
        items: [
          { text: "Client: Writing clients",      link: "/writing-clients" },
          { text: "Ops: Deploying and operating", link: "/deploying" },
          { text: "Mocknet: Full-stack testing",  link: "/testing-clients" },
        ]
      }
    ]
  }
}
