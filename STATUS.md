• Session 2026-06-14 (feature/v0.2-encoder) : design v0.2 + exécution team-dev-exec SYNC. VAGUE 1 (Fondation) + VAGUE 2 (Encoder) FAITES. Reste VAGUE 3 (câblage main.ts).
• Roadmap : GATE capture ✅ → v0.2 Encoder (EN COURS) → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0
• Archi v0.2 (spec 29c6249) : panneau = 1 sous-système + gate(ctx) uniforme ; affichage par DeviceMode courant ; capacité PortConfig → action bascule seulement ; mode-change reporté v0.5. Détection dynamique des panneaux à la connexion.
• VAGUE 1 committée (6 commits 3a7cd50→af87a0c) : capability.ts + panels/{types,registry,deviceInfo} + api.postSetPartial + doc DeviceCapabilities §6.2. 35 tests verts.
• VAGUE 2 committée (5 commits c77c065→6f7af0e) : panels/encoder.ts complet (gate Transmitter, readVariables StreamTransmit, 4 actions name/multicast/start-stop, 2 feedbacks, streamTransmitBody). + durcissement strict-TS tests (def() guard) + hook pretest typecheck (prod+tests). 44 tests verts, build+tsc 0 erreur, QA GO, SDK-review GO.

▶ NEXT = VAGUE 3 (câblage) : Tasks 9-11 du plan docs/superpowers/plans/2026-06-13-v0.2-encoder.md → trim variables/feedbacks/actions au modèle panneau + main.ts (détection capability+role au connect, registre de panneaux, poll() généralisé SANS casser scheduleReconnect main.ts:174-189) + MAJ docs/architecture.md (302→200, modèle panneau).
▶ Réserve Task 10 : re-setActionDefinitions/setFeedbackDefinitions à chaud (à la (re)connexion) = pattern SDK à confirmer en doc Companion. La closure state() fraîche est déjà validée par companion-reviewer.
▶ APRÈS code : UAT v0.2 au futur créneau labo (device requis : enable/disable_stream + set name/multicast fonctionnels). PAS de merge develop sans cet UAT (feedback-delivery-gate).
▶ Le PLAN (57a04b3) = liste de tâches restantes (Tasks 9-11), source de vérité pour reprendre.
