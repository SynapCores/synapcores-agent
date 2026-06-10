# Publishing @synapcores/widget

Two destinations, both free.

## Cloudflare Pages (canonical CDN)

Set repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` once, then
**every push to `master` that touches `widget/`** auto-deploys via
`.github/workflows/widget-cdn.yml`. The bundle becomes reachable at:

- `https://synapcores-widget.pages.dev/widget.js` (default)
- `https://cdn.synapcores.com/widget.js` (after binding the custom domain)

Free tier limits: unlimited bandwidth, 500 builds/month, 25 MB max file
size, custom domain + SSL included. Our 22 KB bundle fits comfortably.

## npm (and jsDelivr + unpkg, free of charge)

Tagged releases auto-publish via the same workflow. From repo root:

```bash
# bump widget version, commit
( cd widget && npm version patch )      # or minor / major
git tag widget-v$(jq -r .version widget/package.json)
git push --tags
```

The workflow's `publish-npm` job triggers on `refs/tags/widget-v*` and
runs `npm publish --access public`. Repo secret `NPM_TOKEN` must hold an
"automation" token from <https://www.npmjs.com/settings/~/tokens>.

Once npm has the package, jsDelivr and unpkg auto-mirror it:

- `https://cdn.jsdelivr.net/npm/@synapcores/widget/dist/widget.js`
- `https://unpkg.com/@synapcores/widget/dist/widget.js`

Three free CDNs for one publish.

## Subresource integrity (recommended for embedders)

Once a version is published, the SHA-384 hash is reproducible — embedders
can pin against it:

```html
<script defer
  src="https://cdn.jsdelivr.net/npm/@synapcores/widget@0.4.0/dist/widget.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-api-base="https://chat.your.com"
  data-project-key="pk_abc123"></script>
```

After publishing, print the integrity hash with:

```bash
openssl dgst -sha384 -binary widget/dist/widget.js | openssl base64 -A
```
