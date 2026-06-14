• Session 2026-06-14 (feature/v0.2-encoder) : design v0.2 + exécution team-dev-exec SYNC. CODE v0.2 COMPLET — Vagues 1+2+3 FAITES. Reste UAT labo avant merge.
• Roadmap : GATE capture ✅ → v0.2 Encoder (CODE FAIT, UAT à venir) → v0.3 Decoder → v0.4 Audio/Vidéo → v0.5 Device-Ops → v1.0
• Archi v0.2 (spec 29c6249) : panneau = 1 sous-système + gate(ctx) uniforme ; affichage par DeviceMode courant ; capacité PortConfig → action bascule (reportée v0.5). Détection dynamique des panneaux à la (re)connexion.
• VAGUE 1 (6 commits 3a7cd50→af87a0c) : capability.ts + panels/{types,registry,deviceInfo} + api.postSetPartial.
• VAGUE 2 (5 commits c77c065→6f7af0e) : panels/encoder.ts (gate Transmitter, readVariables StreamTransmit, 4 actions name/multicast/start-stop, 2 feedbacks, streamTransmitBody). + durcissement strict-TS tests + hook pretest typecheck (prod+tests).
• VAGUE 3 (4 commits 9a264c8→1f90efc) : main.ts migré au modèle panneau (détection capability+role au connect, registre, poll() généralisé, scheduleReconnect INTACT) ; trim variables/feedbacks/actions ; polish checkAllFeedbacks()+types ; suppression dead upgrades.ts (doc convention v2) ; MAJ docs/architecture.md (302→200, modèle panneau).
• Qualité : 44 tests verts, build+tsc 0 erreur. Vérifs indépendantes : architect CONFORME (6/6, scheduleReconnect = identique v0.1), QA GO, companion-reviewer GO (SDK). Réserve SDK levée (re-set*Definitions à chaud supporté, doc+code host).

▶ NEXT = UAT v0.2 au futur créneau labo (device requis). À valider en réel : detection capability/role au connect ; enable_stream/disable_stream fonctionnels ; set_stream_name/set_multicast_address ; feedbacks stream_enabled/stream_name_matches ; le live = les fixtures. Agent uat-runner dispo.
▶ ⚠️ PAS de merge sur develop sans cet UAT réel (feedback-delivery-gate). Code prêt mais NON testé sur device.
▶ Dette tracée : upgradeScripts à réintroduire (export nommé UpgradeScripts) au 1er breaking-change de config — convention documentée dans main.ts.
▶ Le PLAN (57a04b3) Tasks 6-11 = FAIT. Pour v0.3 Decoder : ajouter panels/decoder.ts (gate Receiver, StreamReceive) sur le même modèle.
