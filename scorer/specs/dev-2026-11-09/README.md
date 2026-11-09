# Dev round v2 specs, 9 Nov 2026

The 10 shelves from the first blind round (specs/blind-2026-11-09/, seed 20261110) became the development round, because they exposed bugs. These v2 specs follow the spec-writing rules in scorer/README.md (commit 2f1a9b8). Code under test: shelf-scorer-v1 at 2f1a9b8.

Changes from v1:
- astaxanthin-12mg: required_regex `\b12\s?mg\b` (dose co-term).
- creatine-for-women: required_regex keeps the women co-term and also rejects titles or bullets that say "men & women" or "women and men" (unisex). This is my reading of "for women" as a narrowing word.
- l-theanine-liquid: required_regex `\bliquid\b|\bdrops?\b|\btincture\b` (format co-term) on top of gate_format liquid.
- nad-booster -> nad-supplement.json: shelf keyword "nad supplement" (no "+"), parent null, cluster nad supplement / nad supplements / nad booster / nad supplement powder / nad capsules.
- The other 6 are unchanged from v1 apart from written_at and spec_round. Liposomal urolithin A is left as it was.

## Spec SHA-256
- ea3176d42b3204c680e0aff0203291f5f6c0f56569df6257ab7e3dff489a59e3  astaxanthin-12mg.json
- a87e9308240e6e81dbb5920d659492e6579d5d7d60cc1d714e31b73fecece163  black-garlic.json
- f824d21852a0e73161193401adfa643311b620935d96b54aa14b58367e8b87a5  creatine-for-women.json
- ba248cb15d277147b03275abeb13940bbbde8166cd2b322bcc4cdc243c475e10  inulin-powder.json
- 1fd0571244ccbb9d6bc670f762d9b3bdbbcf345c0a8317926fcea4247f9ba390  l-theanine-liquid.json
- 48c661b2582854ea2e840a920c71b12f30bbbbc7a928e25deb443756b940cbd5  liposomal-urolithin-a.json
- a6868524b56119693ee370fe76325c36285ae7612018180f530d3b2225136581  magnesium-glycinate-gummies.json
- 60f5dbe5aec13cd29021baa843b250c8eb605103244986b56971196c8f04e6a9  nad-supplement.json
- e18e3796f292e98a195ceb038d0c8ceae21268764d3d74b09dcfd2d7774bfa71  saccharomyces-boulardii.json
- bd564fd12f604acb1b1f7af6ac13fb603de230c4e819d3c7543d6fc96f2db076  spermidine.json
