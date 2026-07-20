<p align="center">
  <img src="apps/web/public/art/mascot.png" alt="The BetterBeaver mascot, a beaver reading a book" width="220" />
</p>

# BetterBeaver

Learning is a lot like building a dam: skip too many days and the water finds
the gap. BetterBeaver is a spaced-repetition app that keeps patching that gap
for you — a little bit, every day, on whatever you're learning. Start with
Kyrgyz, or point it at any subject you like.

No cramming, no guilt trips. Just small, well-timed reviews that stick.

**Try it:** [moritzhauer.github.io/BetterBeaver](https://moritzhauer.github.io/BetterBeaver/)

## Documentation

Start with [docs/design.md](docs/design.md) (requirements and design decisions), then
[docs/architecture.md](docs/architecture.md), [docs/STATUS.md](docs/STATUS.md), and the
[plans](docs/plans/) for full detail.

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
