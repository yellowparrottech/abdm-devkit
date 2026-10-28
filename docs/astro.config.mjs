import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://abdm.yellowparrottech.com",
  integrations: [
    starlight({
      title: "YellowParrot ABDM DevKit",
      description: "Build, simulate and validate ABDM integrations without starting with live credentials. Unofficial, open source, Apache-2.0.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/yellowparrottech/abdm-devkit" }],
      customCss: ["./src/styles/theme.css"],
      lastUpdated: false,
      sidebar: [
        { label: "Start here", items: [{ autogenerate: { directory: "start" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
        { label: "Project", items: [{ autogenerate: { directory: "project" } }] },
      ],
    }),
  ],
});
