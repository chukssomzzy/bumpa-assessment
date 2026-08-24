# Changelog

## [1.1.0](https://github.com/chukssomzzy/bumpa-assessment/compare/v1.0.0...v1.1.0) (2026-08-24)


### Features

* achievements, badges and automated cashback ([e27773f](https://github.com/chukssomzzy/bumpa-assessment/commit/e27773ff4c9b0435a5e862b7381e5dbff304eaf7))
* **api:** enforce the response contract at the boundary ([a3b6a77](https://github.com/chukssomzzy/bumpa-assessment/commit/a3b6a77a17d14011b06490e64bb3adf05eeff932))
* **api:** enforce the response contract at the boundary ([fb24e9b](https://github.com/chukssomzzy/bumpa-assessment/commit/fb24e9b2ba574bb018c30c97058016449a3ec3b3))
* **database:** refuse to boot without reference data ([4a329e9](https://github.com/chukssomzzy/bumpa-assessment/commit/4a329e9171db6ab9309c0d579657f7b5c9be47f8))
* **docker:** add opt-in cloudflared tunnel profile for local webhooks ([e126664](https://github.com/chukssomzzy/bumpa-assessment/commit/e126664626698518c346978b673fa9766e5e1cc2))
* **docs:** OpenAPI documentation, and input validation at the boundary ([7e1e759](https://github.com/chukssomzzy/bumpa-assessment/commit/7e1e759b7af73578be546fcce6bb87f657bfd249))
* **docs:** publish an OpenAPI document, and validate input at the boundary ([0d9314d](https://github.com/chukssomzzy/bumpa-assessment/commit/0d9314d82a24da623c649cc80b10412e65d88c51))
* **domain:** pure achievement, badge and tier rules ([f10ccb0](https://github.com/chukssomzzy/bumpa-assessment/commit/f10ccb0bbb7523c6f2ff3f197f84edaeeccbfd44))
* **events:** signed ingest and transactional evaluation ([cb59369](https://github.com/chukssomzzy/bumpa-assessment/commit/cb59369f1991f867fe64885390386dfb52c83f9c)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **infra:** module wiring, docker, ci and integration harness ([0867720](https://github.com/chukssomzzy/bumpa-assessment/commit/086772059924b80564f1b83ddafa323dc3c4f710)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **observability:** error envelope, structured logs and health checks ([996bb35](https://github.com/chukssomzzy/bumpa-assessment/commit/996bb35e607b38532c099fc9f03307d892e2a4b6)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **payouts:** idempotent cashback dispatch with reconciliation ([16269d2](https://github.com/chukssomzzy/bumpa-assessment/commit/16269d2280a7a49b9f172a7ac753e91a28a61557)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **payouts:** reconcile payouts from Paystack transfer webhooks ([60646c4](https://github.com/chukssomzzy/bumpa-assessment/commit/60646c4dccb0a5b97c91f290db4e45ed17f6a9f7))
* Paystack webhook reconciliation, repository layer, GHCR + release-please ([cd6bc2d](https://github.com/chukssomzzy/bumpa-assessment/commit/cd6bc2d28fddd0a708e50035a413bc08cd0d04dd))


### Bug Fixes

* **payouts:** close the remaining double-transfer window ([b513c5a](https://github.com/chukssomzzy/bumpa-assessment/commit/b513c5a8e2dac16f909693ac8b96fa495c462e0e)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **payouts:** stop the sweeper silently stranding payouts ([c4ccd50](https://github.com/chukssomzzy/bumpa-assessment/commit/c4ccd501f10c41c4e7af058c7cdb2da6de2dc6e9)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **payouts:** use a provider reference Paystack accepts ([b6636f2](https://github.com/chukssomzzy/bumpa-assessment/commit/b6636f2974ec7778a8f0843ad1c50910c4a5f30d))
* **security:** bind the timestamp into the HMAC and await event emission ([a903728](https://github.com/chukssomzzy/bumpa-assessment/commit/a903728135732ae8e2467b52268c6b8f851f6b09)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
* **seed:** make every badge reachable and split seed by lifetime ([e4e46cb](https://github.com/chukssomzzy/bumpa-assessment/commit/e4e46cbb379900be9faf6c4236a240989381dad5)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)


### Code Refactoring

* **structure:** group feature modules under src/modules ([2ed7f42](https://github.com/chukssomzzy/bumpa-assessment/commit/2ed7f429be17c847f14509358aa17ce5f863939d)), closes [#2](https://github.com/chukssomzzy/bumpa-assessment/issues/2)
