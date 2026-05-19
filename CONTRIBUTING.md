# Contributing

Thank you for your interest in contributing to companion-module-crestron-nvx.

## Development Setup

```bash
git clone https://github.com/DidierMac/companion-module-crestron-nvx
cd companion-module-crestron-nvx
npm install
npm run build
```

## Running Tests

```bash
npm test
```

Tests use the Node.js built-in test runner (`node:test`) — no additional packages required.

## Docker Development Stack

```bash
docker compose up -d --wait
# Open http://localhost:8000
```

The module is mounted read-only into the container. Rebuild after source changes:

```bash
npm run build && docker compose restart companion
```

## Code Style

- TypeScript strict mode
- ESLint + Prettier: `npm run lint && npm run format`
- No new npm dependencies without discussion

## Submitting Changes

1. Fork the repository
2. Create a branch: `git switch -c feature/your-feature`
3. Commit with clear messages
4. Open a pull request against `main`

## Hardware Testing

If you have access to a Crestron DM NVX device, testing against real hardware is extremely valuable. See [docs/debugging.md](docs/debugging.md) for how to enable verbose logging and capture traces.

## Reporting Issues

Please include:
- Companion version
- Module version
- NVX firmware version
- Verbose log output (see [docs/debugging.md](docs/debugging.md))
