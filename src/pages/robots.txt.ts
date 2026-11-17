export function GET({ site }: { site?: URL }) {
  const origin = site ?? new URL("https://asaberui1.github.io");
  const base = import.meta.env.BASE_URL;
  const sitemap = new URL(`${base}sitemap-index.xml`, origin);

  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap.href}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
