# UAT run — journey

Started: 2026-06-17T07:54:26.009Z

Totals — PASS 18 · FAIL 0 · AMBIGUOUS 0 · HUMAN 0 · SKIP 7

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

### [-] CAP · encoder journey (device is not a Transmitter) (tier 1)
- note: device_role=Receiver

### [-] ENC-VARS · encoder vars (device is not a Transmitter) (tier 1)
- note: device_role=Receiver

### [-] ENC-FEEDBACKS · encoder feedbacks (device is not a Transmitter) (tier 1)
- note: device_role=Receiver

### [-] ENC-NAME · set stream name → device (button unmapped) (tier 1)
- note: button 'set_stream_name' not in layout — see SETUP

### [-] ENC-MULTICAST · set multicast address → device (button unmapped) (tier 1)
- note: button 'set_multicast_address' not in layout — see SETUP

### [-] ENC-ENABLE · start stream → device (button unmapped) (tier 1)
- note: button 'enc_enable_stream' not in layout — see SETUP

### [-] ENC-DISABLE · stop stream → device (button unmapped) (tier 1)
- note: button 'enc_disable_stream' not in layout — see SETUP

### [x] DEC-CAP · decoder panel active (role=Receiver) (tier 1)
- note: device_role=Receiver

### [x] BASELINE-RX · decoder baseline captured (tier 1)
- note: stored for TEARDOWN-RX restore

### [x] DEC-VARS · companion decoder variables == device (tier 1)
- note: 4/4 match

### [x] DEC-SOURCE-URL · set source URL (ByReceiver) → device (tier 1)
- note: device changed as expected

### [x] DEC-SOURCE-MCAST · set source multicast → device (tier 1)
- note: device changed as expected

### [x] DEC-CONNECT · connect to discovered stream by name → device (tier 1)
- note: device changed as expected

### [x] DEC-NEGOTIATING · start reception (negotiating scenario) → CodecReady false, resolution populated (tier 1)
- note: device changed as expected

### [x] DEC-DECODING · start reception (decoding scenario) → CodecReady true (tier 1)
- note: device changed as expected

### [x] DEC-ENABLE · start reception → device (tier 1)
- note: device changed as expected

### [x] DEC-DISABLE · stop reception → device (tier 1)
- note: device changed as expected

### [x] TEARDOWN-RX · decoder restored (tier 1)
- note: StreamReceive baseline re-applied

### [x] TEARDOWN · device restored + connection disabled (tier 1)
- note: device restored; connection disabled
