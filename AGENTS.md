<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Sui Move workflow

- Read the current Sui and dependency documentation before changing Move code.
- Use the repository-local Sui Pilot checkout installed by `npm run setup:sui-pilot`
  as an advisory documentation and review source.
- For contract changes, apply the Sui Pilot quality, security, OpenZeppelin math,
  and specification guidance represented by `/move-code-quality`,
  `/move-code-review`, `/oz-math`, and `/specify`.
- Sui Pilot output does not replace local verification. Run `sui move build` and
  `sui move test` with a Sui CLI compatible with the pinned dependencies.
