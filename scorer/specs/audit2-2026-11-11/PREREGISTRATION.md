# Audit rerun pre-registration, 11 Nov 2026 (Gautam's demand rule)

These are the same 10 shelves as the 10 Nov audit batch, re-specced under the new rule (scorer/README.md, "Demand rule"). The lane keyword, gate co-terms and hero regex are unchanged from specs/blind-2026-11-10 and specs/ideas-2026-11-10. demand_keyword and demand_cluster come from tools/demand_terms.py. Each shelf's log is in demand_logs/<shelf>.json: every parent candidate, the clicks behind each pick, and every keyword that had no data. Epicatechin carries the tracker's 10 Nov manual decision on B0FHH6HM1N (Epitech IN).

| Shelf (lane) | Lane clicks | Demand keyword (clicks) | Other parent candidates | Cluster keywords / clicks |
|---|---|---|---|---|
| beta sitosterol | 2,389 | beta sitosterol (2,389) | beta-sitosterol 707, sitosterol 0 | 5 / 4,167 |
| citrus bergamot | 16,013 | citrus bergamot (16,013) | bergamot 4,613 | 14 / 24,829 |
| colostrum capsules | 845 | colostrum (15,509) | bovine colostrum 1,940 | 9 / 26,917 |
| creatine gummies | 119,635 | creatine (405,621) | creatine monohydrate 275,283 | 25 / 1,019,612 |
| dao enzyme | 9,859 | dao enzyme (9,859) | dao 3,139, diamine oxidase 442 | 5 / 15,386 |
| epicatechin | 1,399 | epicatechin (1,399) | none | 4 / 1,882 |
| horse chestnut | 2,185 | horse chestnut (2,185) | horse chestnut extract 1,892 | 3 / 4,985 |
| korean red ginseng | 3,347 | ginseng (10,112) | panax ginseng 4,104, red ginseng 1,962, korean ginseng 1,421, korean red ginseng 3,347 | 37 / 35,628 |
| magnesium glycinate powder | 13,259 | magnesium glycinate (486,651) | magnesium bisglycinate 87,550 | 30 / 807,504 |
| mastic gum capsules | 788 | mastic gum (17,359) | mastic 714 | 8 / 19,845 |

SHA-256:
- 7387ec87873526812ed258e2cda950c1e9db209c2744ab6ef04491f0c600ce7f  specs/audit2-2026-11-11/beta-sitosterol.json
- 64fe3848c7dd458d6462899dc9720d616fcf909f1af153a14f3ab12587f26836  specs/audit2-2026-11-11/citrus-bergamot.json
- 3f64ec599b6abb848e377cffc89b1f3b059590ad021bddf243fa9c47fc5fc682  specs/audit2-2026-11-11/colostrum-capsules.json
- bdf7874d5064dbf88d43dea9dd9766af396f2a9ab54df52a24ac3ddfd989488c  specs/audit2-2026-11-11/creatine-gummies.json
- 9883be331e63ec414b2a4c04bb80894c70c9961e2e3c0b2d53c67758cff29440  specs/audit2-2026-11-11/dao-enzyme.json
- 9af46b69592226a5abaca79387dba9e16238e6915d875d5b1bfd7048ca0b1702  specs/audit2-2026-11-11/epicatechin.json
- 86be39e1c6e12411026990ee83df4e027b7ef5ec7652dc6fc3f9ea77cdd2615d  specs/audit2-2026-11-11/horse-chestnut.json
- 1e5fc6dc6e70f53c69f41641581724c9dbc9db098e254ec88402bff0674fe49b  specs/audit2-2026-11-11/korean-red-ginseng.json
- 4842c1b7b67cfe2589c6bb162f40c24cc4e876bfc3d2efd881f64852d09f5209  specs/audit2-2026-11-11/magnesium-glycinate-powder.json
- 738ff8bceee4f625d242933702378f505fe1639bfb22ed2897a2f732d24fbba6  specs/audit2-2026-11-11/mastic-gum-capsules.json
