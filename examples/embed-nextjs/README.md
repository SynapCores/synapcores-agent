# Embed @synapcores/widget in Next.js

Two paths — pick one.

## A. Script tag in `app/layout.tsx` (SSR-friendly, no React state)

Two source options — pick one:

```tsx
// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Option 1 — jsDelivr CDN with version pinning + SRI (recommended) */}
        <Script
          src="https://cdn.jsdelivr.net/npm/@synapcores/widget@0.4.0/dist/widget.js"
          integrity="sha384-rn44GdC0gnzNPwhJYHl4TEzahTnCGWtcE/N7QJZ1T5L+Sta8Bh/2d4lga2FaM4NB"
          crossOrigin="anonymous"
          strategy="afterInteractive"
          data-api-base="https://chat.your.com"
          data-project-key={process.env.NEXT_PUBLIC_SYNAPCORES_PROJECT_KEY}
        />
        {/* Option 2 — proxy-hosted (uncomment if you prefer no CDN dep)
        <Script
          src="https://chat.your.com/widget.js"
          strategy="afterInteractive"
          data-api-base="https://chat.your.com"
          data-project-key={process.env.NEXT_PUBLIC_SYNAPCORES_PROJECT_KEY}
        /> */}
      </body>
    </html>
  );
}
```

Set `NEXT_PUBLIC_SYNAPCORES_PROJECT_KEY=pk_abc123` in `.env.local`.

## B. npm package + React component (for `identify()` on auth)

```bash
npm install @synapcores/widget
```

```tsx
// app/components/synapcores-widget.tsx
'use client';
import { useEffect, useRef } from 'react';
import '@synapcores/widget'; // populates window.SynapCores at import time

export function SynapCoresWidget({ user }: { user?: { id: string; name?: string; email?: string } }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const w = (window as any).SynapCores;
    if (!w) return;
    w.init({
      apiBase: process.env.NEXT_PUBLIC_SYNAPCORES_API_BASE!,
      projectKey: process.env.NEXT_PUBLIC_SYNAPCORES_PROJECT_KEY!,
    });
  }, []);

  // Re-identify whenever the logged-in user changes.
  useEffect(() => {
    if (!user) return;
    (window as any).SynapCores?.identify(user);
  }, [user]);

  return null;
}
```

Render `<SynapCoresWidget user={session?.user} />` once in your auth layout.

## What the project key controls

The widget knows nothing about your SynapCores database — the proxy's
`projects.json` defines tenant, database, persona, allowed origins,
rate limit, and the server-held upstream credential. Adding a new site
to the proxy is "add a project entry and an env var" — no widget rebuild.
