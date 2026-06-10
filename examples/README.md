# Embed examples

Three reference embeds — copy, adapt, ship.

| Folder              | Use it when                                            |
| ------------------- | ------------------------------------------------------ |
| `embed-html/`       | Static site, Webflow, Carrd, anything that takes raw HTML |
| `embed-nextjs/`     | Next.js, Remix, Vite + React, Astro                    |
| `embed-wordpress/`  | WordPress site (drop the PHP into `wp-content/plugins/`)  |

All three are the same one-liner under the hood:

```html
<script defer
  src="https://chat.your.com/widget.js"
  data-api-base="https://chat.your.com"
  data-project-key="pk_abc123"></script>
```

Where `https://chat.your.com` is your `@synapcores/widget-proxy` host and
`pk_abc123` is a project key defined in the proxy's `projects.json`.

## When the widget is on a different origin from the embed page

Production embeds are usually cross-origin (your site is `acme.com`,
your proxy is `chat.acme.com`). For the proxy's session cookie to travel
on those WS upgrades, set `session.same_site_none = true` in
`projects.json` — that flips the cookie to `SameSite=None; Secure`. HTTPS
on the proxy becomes mandatory.
