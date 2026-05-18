---
name: companion-release-check
description: Bitfocus official submission pre-flight checklist. Automatically
  verifies all technical requirements and produces a GO/NO-GO report before phase 4.
disable-model-invocation: true
---

# Companion Release Check — Bitfocus pre-submission

Verify all required criteria for an official Bitfocus module submission.

## Automated checks (via Bash/Read)

### Required files
- [ ] `README.md` present and non-empty
- [ ] `companion/HELP.md` present and non-empty
- [ ] `LICENSE` present (MIT text)
- [ ] `CHANGELOG.md` present with v1.0.0 section
- [ ] `.gitignore` contains `node_modules/` and `dist/`

### manifest.json
- [ ] Required fields present: `id`, `name`, `manufacturer`, `products`, `maintainers`
- [ ] `runtime` is an object with `type`, `api`, `apiVersion`, `entrypoint`
- [ ] `runtime.type` is `node22` or `node18`
- [ ] `repository` filled in (GitHub URL)

### package.json
- [ ] `@companion-module/base` ≥ 1.14.1
- [ ] `@companion-module/tools` present ≥ 2.7.2
- [ ] `eslint` and `prettier` in devDependencies
- [ ] `lint` script present

### Source code
- [ ] No `console.log(` in `src/` (grep)
- [ ] `getUpgradeScripts()` present in `src/index.ts`
- [ ] `subscribe` present in `src/feedbacks.ts`
- [ ] `GET /logout` called in `destroy()`

### Build and lint
- [ ] `npm run build` passes without errors
- [ ] `npm run lint` passes without warnings

## Report format

```
## Companion Release Check

### ✅ Passing ([n]/[total])
[list]

### ❌ Blockers
[list with suggested fix]

### ⚠️ Recommended
[non-blocking list]

### Verdict: GO 🚀 / NO-GO 🛑
```

Run checks in order — Bash for automated ones, Read for file content inspection.
