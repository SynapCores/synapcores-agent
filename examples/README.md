# Embed examples

Three reference embeds — copy, adapt, ship.

| Folder              | Use it when                                            |
| ------------------- | ------------------------------------------------------ |
| `embed-html/`       | Static site, Webflow, Carrd, anything that takes raw HTML |
| `embed-nextjs/`     | Next.js, Remix, Vite + React, Astro                    |
| `embed-wordpress/`  | WordPress site (drop the PHP into `wp-content/plugins/`)  |

All three are the same one-liner under the hood. Two source options:

```html
<!-- A. jsDelivr CDN, version-pinned + SRI (recommended for production) -->
<script defer
  src="https://cdn.jsdelivr.net/npm/@synapcores/widget@0.4.0/dist/widget.js"
  integrity="sha384-rn44GdC0gnzNPwhJYHl4TEzahTnCGWtcE/N7QJZ1T5L+Sta8Bh/2d4lga2FaM4NB"
  crossorigin="anonymous"
  data-api-base="https://chat.your.com"
  data-project-key="pk_abc123"></script>

<!-- B. Proxy-hosted (no external CDN dependency) -->
<script defer
  src="https://chat.your.com/widget.js"
  data-api-base="https://chat.your.com"
  data-project-key="pk_abc123"></script>
```

`https://chat.your.com` is your `@synapcores/widget-proxy` host;
`pk_abc123` is a project key defined in the proxy's `projects.json`.
Whichever source you pick, the proxy still owns sessions + the WS pipe
to SynapCores — the only difference is where `widget.js` itself is
fetched from.

Mirrors (all free, in order of likely speed for global visitors):
- `https://cdn.jsdelivr.net/npm/@synapcores/widget@0.4.0/dist/widget.js`
- `https://unpkg.com/@synapcores/widget@0.4.0/dist/widget.js`

## When the widget is on a different origin from the embed page

Production embeds are usually cross-origin (your site is `acme.com`,
your proxy is `chat.acme.com`). For the proxy's session cookie to travel
on those WS upgrades, set `session.same_site_none = true` in
`projects.json` — that flips the cookie to `SameSite=None; Secure`. HTTPS
on the proxy becomes mandatory.
