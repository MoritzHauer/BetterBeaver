# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

BetterBeaver is a pnpm TypeScript monorepo (strict mode): `packages/schema`, `packages/srs`, `packages/engine` are headless packages, and `apps/web` is a Vite + React app (PWA support planned).

Commands (from repo root):

- `corepack pnpm install` — install dependencies
- `corepack pnpm check` — format check + lint + typecheck + tests (the quality gate)
- `corepack pnpm dev` — run the web app locally

See `docs/plans/0001-content-schema-and-kyrgyz-slice.md` for the domain model and architecture.

`docs/STATUS.md` tracks plan status and known gaps — update it whenever a plan lands or a listed gap changes.
