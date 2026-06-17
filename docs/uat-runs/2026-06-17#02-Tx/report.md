# UAT run — journey

Started: 2026-06-17T07:55:32.072Z

Totals — PASS 15 · FAIL 0 · AMBIGUOUS 0 · HUMAN 0 · SKIP 10

### [x] INSTALL · module available (tier 1)

### [x] CFG-NOPASS · empty password → BadConfig (tier 1)
- note: status=warning + cause logged

### [x] CFG-UNREACHABLE · unreachable IP → ConnectionFailure (tier 1)
- note: status=error + cause logged

### [x] CFG-WRONGPASS · wrong password → AuthenticationFailure (tier 1)
- note: auth failure + logged (1 login used)

### [x] CFG-GOOD · connected (oracle confirms session) (tier 1)
- note: status good + oracle read stream

### [x] BASELINE · baseline captured (tier 1)
- note: stored for TEARDOWN restore

### [x] CAP · encoder panel active (role=Transmitter) (tier 1)
- note: device_role=Transmitter

### [x] ENC-VARS · companion variables == device (tier 1)
- note: 4/4 match

### [x] ENC-FEEDBACKS · feedback source matches device (tier 1)
- note: tx_enabled=true

### [x] ENC-NAME · set stream name → device (tier 1)
- note: device changed as expected

### [x] ENC-MULTICAST · set multicast address → device (tier 1)
- note: device changed as expected

### [x] ENC-ENABLE · start stream → device (tier 1)
- note: device changed as expected

### [x] ENC-DISABLE · stop stream → device (tier 1)
- note: device changed as expected

### [-] DEC-CAP · decoder panel (device is not a Receiver) (tier 1)
- note: device_role=Transmitter

### [-] BASELINE-RX · baseline-rx (device is not a Receiver) (tier 1)
- note: device_role=Transmitter

### [-] DEC-VARS · decoder variables (device is not a Receiver) (tier 1)
- note: device_role=Transmitter

### [-] DEC-SOURCE-URL · set source URL (ByReceiver) → device (button unmapped) (tier 1)
- note: button 'set_source_url' not in layout — see SETUP

### [-] DEC-SOURCE-MCAST · set source multicast → device (button unmapped) (tier 1)
- note: button 'set_source_multicast' not in layout — see SETUP

### [-] DEC-CONNECT · connect to discovered stream by name → device (button unmapped) (tier 1)
- note: button 'connect_to_stream' not in layout — see SETUP

### [-] DEC-NEGOTIATING · start reception (negotiating scenario) → CodecReady false, resolution populated (button unmapped) (tier 1)
- note: button 'dec_enable_stream' not in layout — see SETUP

### [-] DEC-DECODING · start reception (decoding scenario) → CodecReady true (button unmapped) (tier 1)
- note: button 'dec_enable_stream' not in layout — see SETUP

### [-] DEC-ENABLE · start reception → device (button unmapped) (tier 1)
- note: button 'dec_enable_stream' not in layout — see SETUP

### [-] DEC-DISABLE · stop reception → device (button unmapped) (tier 1)
- note: button 'dec_disable_stream' not in layout — see SETUP

### [x] TEARDOWN-RX · decoder restored (tier 1)
- note: StreamReceive baseline re-applied

### [x] TEARDOWN · device restored + connection disabled (tier 1)
- note: device restored; connection disabled
