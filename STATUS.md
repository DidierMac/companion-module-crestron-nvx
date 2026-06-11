• Session 6 (2026-06-11) : re-planification roadmap AV + outillage capture/UAT (sur feature/capture-tooling, 6 commits, non mergée)
• Roadmap révisée : GATE capture → v0.2 Encoder → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0 (spec 2026-06-11 sur develop)
• Capture : scripts/capture-nvx.ts (réutilise NvxApiClient, sans npm install) + brief agent nvx-api-explorer → prête pour le gate du 2026-06-12
• UAT : docs/UAT.md exécutable (anti-faux-positif) + agent uat-runner (2 modes) ; Option A retenue, Option B préparée (plan, non activée)

▶ DEMAIN 2026-06-12 : GATE hardware — capture JSON live (nvx-api-explorer) → docs/hardware-validation.md ; puis merger feature/capture-tooling sur develop
▶ Dry-run à planifier : lancer Companion (Docker, sans device) pour valider l'agent uat-runner ET capturer les selectors DOM (pré-requis Option B)
▶ Ensuite : spec v0.2 Encoder sur JSON vérifié → writing-plans → code hors-ligne + fixtures
▶ Backlog : supprimer coquille feature/v0.2 ; toggle HTTP/HTTPS ; back-merge develop→main à la v1.0
