# Plan — Option B : suite Playwright e2e committée (préparation)

**Date** : 2026-06-11
**Statut** : **PRÉPARÉ, NON ACTIVÉ** — gate Zéro Installation (décision Didier requise pour installer).
**Relation** : Option A (agent `uat-runner` + Playwright MCP) reste le défaut. B est l'« upgrade » déterministe/rejouable. **Source de vérité commune : `docs/UAT.md`.**

---

## 1. Pourquoi / quand activer B

Activer B quand au moins un de ces besoins apparaît :
- Rejouer l'UAT **sans Claude** (autre dev, ou exécution non interactive).
- Artefact de test **déterministe et diffable** (revue de code, historique).
- **CI future** (en gardant à l'esprit que le labo isolé + les étapes physiques `[HUMAN]` limitent l'automatisation totale).

Tant qu'aucun de ces besoins ne mord, **A suffit** et coûte moins.

## 2. Gate d'activation (Zéro Installation — décision Didier)

B nécessite des dépendances et des changements `package.json` **interdits sans ton accord** :
```bash
npm install -D @playwright/test          # runner + API de test
npx playwright install chromium          # binaire navigateur (~150 Mo)
# Optionnel (reporting riche) :
npm install -D allure-playwright         # + Allure CLI
```
Scripts à ajouter (`package.json`) :
```json
"test:e2e": "playwright test",
"test:e2e:report": "playwright show-report"
```
**Tant que non approuvé, ce plan reste documentaire — aucun fichier `e2e/` ni modif `package.json` n'est créé.**

## 3. Pré-requis bloquant : capturer les selectors Companion (dry-run)

Les specs s'appuient sur le **DOM réel** de Companion (badge de statut d'instance, onglet Variables, onglet Log). Ces selectors sont **inconnus aujourd'hui** (Companion jamais inspecté).
→ Une **session dry-run** avec Companion up (Docker, voir mémoire `ops-workflow`) sert à :
  1. **Valider l'option A** (l'agent `uat-runner` navigue-t-il bien l'UI ?).
  2. **Capturer les selectors** réels pour le Page Object Model de B.

**Ne jamais deviner les selectors** — même anti-pattern que deviner les chemins JSON (piège des 14 bugs).

## 4. Structure cible

```
e2e/
  playwright.config.ts
  pages/                    # Page Object Model (selectors capturés au dry-run)
    companion-app.ts        # navigation globale (onglets)
    connections.page.ts     # add/config/enable/disable instance, lire le statut
    variables.page.ts       # lire une variable Companion
    log.page.ts             # lire/filtrer les logs [INIT]/[AUTH]/[CONN]/[HTTP]/[POLL]
  helpers/
    manual-checkpoint.ts    # pause étape [HUMAN] + sign-off
    nvx-config.ts           # config host/user via env (NVX_*), jamais committé
  specs/
    v0.1-connection.spec.ts # AUTH-EMPTY/WRONG/GOOD, HB-*, FB-*, LOG-*, CONN-*
    v0.2-encoder.spec.ts    # (après v0.2)
  fixtures/
    uat-journal.ts          # écrit docs/uat-runs/<date>.md + met à jour le journal UAT.md
```

## 5. `playwright.config.ts` (référence)

```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,        // HIL : un seul device réel → séquentiel
  workers: 1,
  retries: 0,                  // un échec UAT doit être analysé, pas masqué par un retry
  reporter: [['html'], ['list']],   // + ['allure-playwright'] si activé
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: 60_000,             // matériel : délais variables (mais jamais de sleep fixe dans les specs)
})
```

## 6. `manualCheckpoint` — cœur hardware-in-the-loop (référence)

```ts
import { test } from '@playwright/test'
import readline from 'node:readline/promises'

/** Pause pour une étape physique [HUMAN] + capture du sign-off. */
export async function manualCheckpoint(instruction: string): Promise<void> {
  test.info().annotations.push({ type: 'manual', description: instruction })
  if (process.env['CI']) {                 // CI unattended : on ne peut pas agir physiquement
    test.skip(true, `Étape manuelle non exécutable en CI : ${instruction}`)
    return
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log(`\n⏸️  ACTION MANUELLE REQUISE :\n${instruction}`)
  const who = await rl.question('Confirmer (qui / Entrée) > ')
  rl.close()
  test.info().annotations.push({ type: 'sign-off', description: who || 'confirmé' })
}
```
> Les étapes `[HUMAN]` ne tournent pas en Cct unattended → `skip` + annotation en CI, pause en local. Les `[AUTO]` tournent partout.

## 7. Mapping `UAT.md` → specs

Chaque cas UAT (`AUTH-EMPTY`, `CONN-DESTROY`, …) = un `test()` dont les étapes reprennent précondition/action/attendu, et dont les **pièges deviennent des assertions explicites** (preuve fraîche, transition vue, proxy positif d'absence).

Exemple `AUTH-WRONG` (absence de boucle — le cas délicat) :
```ts
test('AUTH-WRONG : 1 tentative, pas de boucle', async ({ page }) => {
  const conn = new ConnectionsPage(page)
  await conn.setInstanceConfig({ password: 'DELIBERATELY_WRONG' })  // ⚠️ UNE seule fois (lockout)
  await conn.reInit()
  await expect(conn.statusBadge).toHaveText(/AuthenticationFailure/i)
  // Test d'absence : préférer un proxy positif si le code en émet un ([CONN] annulé).
  // Sinon, fenêtre d'observation EXPLICITE (seule exception au "pas de sleep").
  const before = await log.countAuthAttempts()
  await page.waitForTimeout(30_000)
  expect(await log.countAuthAttempts()).toBe(before)               // aucune nouvelle tentative
})
```

## 8. Reporting

- **Défaut, zéro dépendance en plus** : reporter HTML natif Playwright → `playwright-report/`.
- **Optionnel** : `allure-playwright` (install séparé) pour historique riche + sign-offs.
- **Toujours** : écrire le journal dans `docs/uat-runs/` + mettre à jour le journal de `UAT.md` (cohérent avec l'agent A).
- Labo isolé → **stocker les artefacts en local** (pas de CI cloud), sauvegarder avant tout cleanup.

## 9. Étapes d'activation (turnkey, une fois approuvé)

1. **[Didier]** approuver l'install (lève le gate Zéro Installation).
2. `npm install -D @playwright/test` + `npx playwright install chromium`.
3. **Dry-run** (Companion up) : capturer les selectors → remplir le POM (`e2e/pages/`).
4. Écrire `e2e/` selon ce plan ; traduire d'abord les cas **v0.1** de `UAT.md`.
5. Ajouter les scripts `package.json` ; `npm run test:e2e`.
6. Valider la parité A↔B sur v0.1, puis étendre aux versions suivantes au fil du cycle AV.

---

## Reste à faire avant activation
- [ ] Dry-run Companion (valide A + capture selectors) — **prochaine session avec Docker up**.
- [ ] Décision install (gate Zéro Installation).
- [ ] Confirmer le besoin réel (sinon rester en A).
