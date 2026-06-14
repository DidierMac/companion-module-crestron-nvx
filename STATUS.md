• Session 2026-06-14 (EN COURS sur feature/v0.2-encoder) : design v0.2 (brainstorm archi + spec 29c6249 + plan 57a04b3) puis exécution team-dev-exec SYNC. VAGUE 1 (Fondation) FAITE.
• Roadmap : GATE capture ✅ → v0.2 Encoder (EN COURS) → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0
• Archi v0.2 (spec 29c6249) : panneau = 1 sous-système + gate(ctx) uniforme ; affichage par DeviceMode courant ; capacité PortConfig → action bascule seulement ; mode-change reporté v0.5. Détection dynamique des panneaux à la connexion.
• VAGUE 1 committée (6 commits atomiques 3a7cd50→af87a0c) : capability.ts + panels/{types,registry,deviceInfo} + api.postSetPartial + doc DeviceCapabilities §6.2. 35 tests verts, build clean, code-review GO.

▶ NEXT = VAGUE 2 (Encoder) : Tasks 6-8 du plan docs/superpowers/plans/2026-06-13-v0.2-encoder.md → src/panels/encoder.ts (gate role==Transmitter, readVariables StreamTransmit, actions name/multicast/start-stop, feedbacks). Reprendre via /team-dev-exec sync sur le plan.
▶ PUIS VAGUE 3 = Tasks 9-11 : câblage main.ts (poll généralisé, NE PAS casser scheduleReconnect) + trim variables/feedbacks/actions + MAJ architecture.md. Réserve : re-setActionDefinitions à chaud = pattern SDK à confirmer en doc.
▶ APRÈS code : UAT v0.2 au futur créneau labo (device requis : set_stream_mode reboot, enable/disable_stream). PAS de merge develop sans cet UAT (feedback-delivery-gate).
▶ Le PLAN (57a04b3) = liste de tâches restantes, source de vérité pour reprendre après compact.
