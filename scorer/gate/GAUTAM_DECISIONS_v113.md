# Gautam gold-set decisions — 28 Oct 2026 21:22 IST

1. Bundles where the hero product is named first (e.g. Solaray DAO bundle): COUNT (IN).
2. Reseller copies of the same product (e.g. Purely Nutrient black seed pair): COUNT ONCE (variant/reseller collapse).
3. Kids / toddler products (e.g. MaryRuth's toddler iron drops): EXCLUDE (new code EX_KIDS; extends pet/infant exclusion).
4. Mixed-form magnesium gummies on the mag glycinate gummies shelf: IN if the title leads with glycinate; OUT if it says "complex" or leads with another form (rulebook v1.1 locked).

Apply in gold_set_v2; log in ERROR_LOG.md.

# Round 2 — 29 Oct 2026 ~11:41 IST (Gautam)
Q2 Clones with different brand names: COUNT SEPARATELY.
Q1 All-ages "Adults & Kids" products: COUNT (only kids-only excluded).
Q5 Same brand + same formula under different name/size (Blood Builder vs Minis, Dulac 500 vs Dinaven, Nature Made 60 vs 90, Gynable variants, VITASUPPORTMD diosmin bundles): MERGE into one product.
Q3 Multi-form lists that lead with glycinate (14-in-1 gummy, MegaFood Gly/Malate/Citrate): BOTH IN.
Q6 Natrol Sleep & Restore Mag Glycinate Blend Gummies (+GABA): IN.
Q7 Florastor Advanced Gas & Bloat (both pack sizes): OUT — hero ingredient name not on title or front packaging.
   NEW GENERAL RULE (G-NAME): the hero ingredient must be named on the title or front packaging to count.
   CONFLICT: Q4 CircuLegs (Solaray) was answered "count it", but its title lacks horse chestnut. Applying G-NAME (newer, stated as principle): CircuLegs OUT unless Gautam overrides. Flagged to him 29 Oct.
Q8 '(180 Gummies) Creatine Monohydrate Gummies' with PDP item form Tablet: IN — title and bullets beat PDP item form.

# Round 3 — 29 Oct 2026 ~13:02 IST (Gautam, after gate v9 FAIL)
R3-1 "N-in-1" / "Complex" titles that lead with the hero (9-in-1 Nattokinase, 10-in-1 NMN Complex, Threonate Complex, Phytosome Complex): COUNT as hero-led.
R3-2 Delivery words before the hero (Liposomal, Chelated, Phytosome, etc.): IGNORE on a plain shelf and count. NUANCE: if the shelf keyword itself names a delivery tech (e.g. "liposomal quercetin"), only products with that delivery tech count — same logic as format shelves (gummies).
R3-3 Brand-coined names with no hero in the title (Florastor Advanced Immunity, Saccharomycin, OptiFerin-C, Youthful Legs): KEEP OUT.
R3-4 CircuLegs: KEEP OUT (override resolved; title "SOLARAY Circulegs, 120 VegCaps" lacks horse chestnut).
R3-5 Same brand + same ingredients, different dose (Dorado Epicatechin 500 vs 750 mg): TWO products. Note: Q5 merge applies to same formula/same dose under different name or count; a dose change = separate product.

# Round 4 — 29 Oct 2026 ~15:23 IST (Gautam, after gate v9.1 FAIL)
R4-1 Form-named shelf where the title names only the generic hero ("Iron") and the required form (bisglycinate) appears only in PDP details/bullets: COUNT. (Hero NAME must be on title/front per G-NAME; the FORM may come from PDP.)
R4-2 Benefit-word formula names before the hero ("Vein Formula Diosmin 1000mg", "Lymphatic Formula"): COUNT — the hero still leads the product.
R4-3 Same brand, same product, dose expressed differently ("200 mg per serving" vs "300 mg per 3 caps", Nature Made): ONE product. Normalise dose per unit before comparing; R3-5 (different dose = two products) applies only to a genuinely different per-unit dose.
Settled by existing rules (NPD, told Gautam): bundles count only if hero named first (R1) -> Stamets 7 + Turkey Tail OUT of turkey tail; "for Humans & Pets" follows all-ages rule (Q1) -> COUNT, not pet. Lion's curly-apostrophe miss is a gate bug to fix in v9.2.

## Round 5 (29 Oct 2026, ~18:15 IST)
- R5-1 Hero + one vitamin (e.g. Pure Encapsulations Iron-C on iron bisglycinate): COUNT, hero leads.
- R5-2 Same brand, capsules vs powder of same herb (e.g. INCAS): TWO products, unless the shelf names a format (e.g. capsules), then only that format counts.
- R5-3 Akkermansia blends: Pendulum Metabolic Daily (B0BRM7S31J, 5-strain, Akkermansia first on label) COUNT; Codeage GLP-1 Probiotic+, Akkermansia (B0D77YRWRY, Akkermansia 2nd of 3 strains, in title) COUNT; Metagenics UltraFlora Triplebiotic with Akkermansia (B0DCWMPZZ6) OUT. General: a blend counts when the hero is featured prominently (title/front of pack); a branded base product "with [hero]" add-in is out. Supersedes the earlier HERO_SECONDARY call on 042 and 029.
- R5-4 Bulk single-herb culinary-style root powder (e.g. 100g bag, no dose): OUT, EX_NOT_SUPPLEMENT.

## Round 6 (29–30 Oct 2026)
- R6-1 Omne Diem "Histamine Digest PureMAX with DAO" (B0DSJW4MC5 / B0DSJS74BX): COUNT. DAO is the only active; the coined name is just the product name. Refines R5-3: "[Coined name] with [hero]" is out only when the label shows a broader base formula (e.g. UltraFlora probiotic); if the hero is the sole/lead active on the label, it counts.
- R6-2 NOW Cordyceps 750mg 90 caps (B0045X9VQC) vs "Organic" 200 caps (B07KGMDN75): TWO products (organic vs non-organic is a different formula).
- R6-3 "Complete Beauty Complex with 5000mcg Biotin" (B07L8KPCFY) on biotin gummies: COUNT.
- Settled by NPD from R5-4 (bulk/culinary no dose = not a supplement): dried tart cherries, whole cooking fenugreek seeds, bulk nettle root cut & sifted 1 lb are EX_NOT_SUPPLEMENT. Holdout v93 labels for B0DQVTCPMZ and B000WR8K8A were likely errors.

## NPD settle (30 Oct 2026, ~16:07 IST)
- Settled by NPD from R3/R4 form-shelf rule (not a Gautam ruling): on a form-named shelf (copper bisglycinate) a title word like "Chelated" does not override the label; if the label shows a different compound (cuprous nicotinate / Cuprous Nicotinic Acid), it is the wrong form, OUT (EX_FORM_MISMATCH). Bio-Active Copper Cu1 B09DZYSNL3 and MitoSynergy BioCopper1 B0F5P5W1FV are OUT of copper bisglycinate. Holdout v94 labels already say so; no label change.

## Round 7 (31 Oct 2026)
- R7-1 (Gautam, 31 Oct): OLLY Goodbye Stress B01M1HYRNJ is OUT on l theanine gummies. The title doses 50mg L-theanine, but GABA 100mg leads the label. General rule: when a different, higher-dose active leads the label, the product is out (HERO_SECONDARY), even if the title names and doses the hero.
- Settled by NPD (not a Gautam ruling): a misspelled hero name in the title ("Ginko" Biloba B01AGLL2RW, "Donq Quai" B0FBLX4DCP) counts as naming the hero.

## Round 8 (1 Nov 2026)
- R8-1 (Gautam, 1 Nov): Quantum TheraZinc B06XVYR19G COUNTS on zinc gluconate. General rule: a coined name that contains the hero word ("TheraZinc") names the hero when the hero leads the label. Refines R3-3 (coined names with NO hero word stay out; Saccharomycin/OptiFerin-C do not contain the full hero word).

## Round 9 (1 Nov 2026, ~12:13 IST)
- R9-1 (Gautam, 1 Nov): Cold-EEZE B08938GBKJ COUNTS on zinc gluconate. General rule: a homeopathic-labelled product whose active is a real nutrient at a low X dilution (1X/2X) or a material mg dose counts. Classic high-dilution homeopathics (C potencies such as 6C/30C, Boiron-style pellets) stay out. Refines the v1.9 homeopathic settle.
- Settled by NPD (not a Gautam ruling): Maximum Slim "Pure Kidney Bean Extract" B00EJPZDT0 COUNTS on white kidney bean; the label lead is White Kidney Bean Extract (same principle as R4-1: the qualifier may come from the label when the title names the hero ingredient).
- Settled by NPD (not a Gautam ruling): OLLY Sleep B09S36JRMR is OUT on melatonin gummies under R7-1 (L-theanine 100 mg leads melatonin 3 mg).

## Round 10 (1 Nov 2026, ~14:50 IST)
- R10-1 (Gautam, 1 Nov): Goli Pre Pro Postbiotic B0BZ1CKHVL COUNTS on probiotic gummies. General rule: an equal-billed N-in-1 whose title names the hero as one of its co-equal actives counts, even if another active is first on the label. Exception to R7-1; R7-1 still applies when the hero is a minor add-in.
- Settled by NPD under R7-1 (not a Gautam ruling): Planetary Herbals Pau d'Arco B000Q3Z0GK is OUT (burdock-led blend leads the label).
- Settled by NPD under the lead-form rule (not a Gautam ruling): Life Extension Zinc Caps B004S8CNMS is OUT on zinc citrate (monomethionine listed first).
- Settled by NPD under R6-1 (not a Gautam ruling): Organic Immune Support with Pau D'Arco B0DKGDWKCZ is OUT (no label; description leads with garlic and vitamins).
- Settled by NPD under R10-1 (not a Gautam ruling): "Phosphatidylserine & Bacopa Monnieri ... 2 in 1" B08MWVSKST and B08437WBN9 COUNT on bacopa (equal-billed 2-in-1 names bacopa as co-equal). Applied to a dev copy holdout_v97/holdout_labels_r10_corrected.json; original v97 labels untouched.

## Round 11 (1 Nov 2026, ~15:50 IST)
- R11-1 (Gautam, 1 Nov): a trademarked hero-ingredient name counts as naming the hero, even when the generic word is missing from the title. ChromeMate = chromium polynicotinate, so Pure Encapsulations ChromeMate GTF 600 B0016QTLRU and Klaire Labs Chromemate B00JVYDG2U COUNT on chromium polynicotinate. Consistent with 5-Loxin = boswellia.
- Settled by NPD (not a Gautam ruling): "GTF" (glucose tolerance factor) is a descriptor of chromium polynicotinate, not a different chromium form.
- Settled by NPD under R5-3 (not a Gautam ruling): NuEthix SLIN-Trol B0CT1NFGX5 is OUT on chromium polynicotinate (chromium is an add-in to a coined formula).

## Round 12 (1 Nov 2026, 17:34 IST)
- R12-1: Precursor-pair powders that form the hero salt in water and are sold as that form count on the hero shelf. NaturalSlim MagicMag B00U9LEEYI (magnesium carbonate + citric acid) COUNTS on magnesium citrate. Gold unchanged (append-only); applies from the next gate version.

## Round 13 (2 Nov 2026, 19:40 IST; v11 spot-check)
- R13-1: When the hero leads the title of a hero-plus-vitamins/minerals product, it counts even when the label lists the vitamins and minerals first (supplement-facts convention). Airborne Elderberry + Zinc & Vitamin C Gummies B08VK4ZF87 COUNTS on elderberry. R7-1 still applies when a different botanical or active leads.
- NPD-settled (v11 spot-check, existing rules): Vive Organic Ginger Boost Shot B0C7X44CB3 OUT (juice beverage, apple juice leads; R7-1 + non-supplement); Balance ONE Zinc Carnosine and L-Glutamine B0F49VVGTN COUNTS (R10-1 equal-billed pair); yarrow seeds B0H2FMXTW3 OUT (non-supplement), yarrow salve B0BM89KGXK and yarrow essential oil B07M7B1X24 OUT (topical, P3 exclusion); Amazon Basics Elderberry Complex lozenges B07BFRC6G5 COUNTS (R13-1); Nature's Way Sambucus lozenge B08CBQB657 COUNTS (hero leads title and label); Sangluco Berberine N-in-1 B0FXNQY3H3 COUNTS (R10-1); Toniiq Triple Blend Zinc Carnosine B0GQ371264 OUT (hero-only title over a glutamine-led blend, R7-1 / Planetary precedent).
- R13-2: A classical named formula whose name includes the hero counts even when another ingredient leads the label. Banyan Triphala Guggulu B000Q48DGS COUNTS on triphala (guggulu first). R7-1 still applies to non-classical blends.
- R13-3 (3 Nov 2026): A derivative compound of the hero (e.g. dihydroberberine) is its own shelf and is OUT on the parent shelf. Nutricost Dihydroberberine B0D4RMJ8NB OUT on berberine capsules.
- R13-4 (3 Nov 2026): Softgels count on a capsules shelf, and a carrier oil (MCT 500mg) is not an active under R7-1. NOW Berberine Glucose Support softgels B07PSMZ3J1 COUNT.
- R13-5 (3 Nov 2026): A 2-in-1 title "X & [hero]" counts as equal billing even when X is named first and there's no label on the listing (extends R10-1). Papaya & Kudzu Capsules B0H7QPM7GQ COUNTS on kudzu.
- R13-6 (3 Nov 2026): Hero listed first on the label and named alone in the title counts even if a later active has a higher dose; R7-1 bites only when another active LEADS the label. Zinc Carnosine 75mg gummy B0G4QXWNF2 (L-glutamine 500mg) COUNTS.
- R14-1 (29 Oct 2026, shelf top-10 ruling; added to this file 8 Nov 2026 with Gautam's OK): Condition-led formulas are OUT even when the hero is listed first under the condition headline (MOVE Joint Relief, sciatic formulas, OsteoShield). The product must lead with the hero, not with a condition.
- R14-2 (8 Nov 2026, Gautam's OK): A whole food sold by weight (oz, lb, g, kg in the title) with no oral supplement form (capsule, softgel, tablet, gummy, powder with a serving, drops, liquid with a serving) and no human serving dose is OUT (EX_NOT_SUPPLEMENT). Whole black garlic bulbs and peeled cloves sold as food are OUT on a black garlic shelf; aged black garlic extract softgels COUNT.
