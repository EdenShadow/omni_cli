# Omni CLI 0.3.18

Synchronizes the device bridge with Wanwu AI 1.2.476. Encrypted history supplies safe routing metadata so message and AI-response visibility can be enforced separately. Legacy privacy defaults are verified by the execution device without replacing explicit user choices. Codex final responses with a missing completion notification are reconciled only after two authoritative idle checks; active or unverified tasks are never stopped or replayed.

This release keeps existing login, NAS and model configuration. There is no bundled Quikwin CLI or local AI runtime. Omni Mini is unchanged because it does not execute AI sessions.

Validation uses mocked local runtimes, the CLI test suite and the 130-module import graph check. No paid model execution is required.
