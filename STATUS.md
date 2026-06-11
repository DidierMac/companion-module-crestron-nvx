• Session 6 (2026-06-11) : re-planification roadmap AV validée + committée (spec 2026-06-11, sur develop)
• Roadmap révisée : GATE capture → v0.2 Encoder → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0 (4 versions distinctes, tranches verticales)
• Workflow device-rare : capture groupée → fixtures de test → code hors-ligne → UAT événementiel (cascade au créneau labo). Branches stack linéaire.
• Fondations v0.2 (architecte) : POST/cookies/câblage init = prêts ; seule brique = généraliser poll() → 1er commit de feature/v0.2-encoder. Entrée réelle = src/main.ts.

▶ Prochaine étape : GATE hardware le 2026-06-12 — capture JSON live (nvx-api-explorer) → docs/hardware-validation.md
▶ En cours : feature/capture-tooling — script de capture .ts réutilisant NvxApiClient (creds via process.env)
▶ Ensuite : spec d'implémentation v0.2 Encoder sur JSON vérifié → writing-plans → code hors-ligne + fixtures
▶ Backlog : supprimer coquille feature/v0.2 ; toggle HTTP/HTTPS ; back-merge develop→main à la v1.0
