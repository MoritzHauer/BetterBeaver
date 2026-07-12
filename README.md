# BetterBeaver

This is a general learning platform upgrade your skills on a daily level.BetterBeaver helps you get better every day with focused learning, repeatable practice, and skill-building across any topic.

## Development

```sh
corepack pnpm install
corepack pnpm check
corepack pnpm dev
```

## Install on your phone

Service workers require a secure context off `localhost`, so serve the build behind local TLS
(`mkcert <lan-ip>` generates a locally-trusted cert pair, which `vite.config.ts` picks up from
the two env vars):

```sh
corepack pnpm --filter @betterbeaver/web build
mkcert <lan-ip>  # writes <lan-ip>.pem and <lan-ip>-key.pem
PREVIEW_HTTPS_CERT=<lan-ip>.pem PREVIEW_HTTPS_KEY=<lan-ip>-key.pem \
  corepack pnpm --filter @betterbeaver/web preview --host
```

Then open `https://<lan-ip>:4173` on the phone. On iOS, first install and trust the `mkcert` root
CA profile (`mkcert -CAROOT`) on the phone. On Android, you can skip TLS entirely by tunneling:
`adb reverse tcp:4173 tcp:4173`, then open `http://localhost:4173` on the phone.
