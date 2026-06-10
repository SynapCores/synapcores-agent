# Embed @synapcores/widget in Next.js

Two paths — pick one.

## A. Script tag in `app/layout.tsx` (SSR-friendly, no React state)

```tsx
// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://chat.your.com/widget.js"
          strategy="afterInteractive"
          data-api-base="https://chat.your.com"
          data-project-key={process.env.NEXT_PUBLIC_SYNAPCORES_PROJECT_KEY}
        />
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
