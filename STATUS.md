• Session 6 (2026-06-11) close : re-planification roadmap AV + outillage capture/UAT, sur feature/capture-tooling (10 commits, NON mergée)
• Roadmap : GATE capture → v0.2 Encoder → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0 (spec 2026-06-11 sur develop)
• Capture prête : scripts/capture-nvx.ts (sans npm install) + brief nvx-api-explorer → pour le gate du 2026-06-12
• UAT : plan exécutable docs/UAT.md + agent uat-runner (2 modes) ÉPROUVÉ ; run partiel sans device = 3 PASS/0 FAIL (A1,C2,B5), 8 cas [-] device requis ; Option A retenue, Option B préparée (plan, non activée)

▶ DEMAIN 2026-06-12 : GATE hardware — capture JSON live (nvx-api-explorer) → docs/hardware-validation.md ; PUIS merge feature/capture-tooling → develop
▶ Créneau labo : dérouler les 8 cas UAT [-] device-dépendants (ordre non négociable, budget lockout A2=1 tentative)
▶ Après capture : spec v0.2 Encoder sur JSON vérifié → 1er commit = généraliser poll() (cf. mémoire architecture-v0.2-foundations) → fixtures + code
▶ Backlog : supprimer coquille feature/v0.2 ; toggle HTTP/HTTPS ; back-merge develop→main à la v1.0 ; activer Option B (gate npm install + dry-run selectors fait)
