# Shelf Rulebook — competitor-set gate (v1, 2026-10-28)

Purpose: one written rule per shelf, so that "who counts as a competitor" is decided by rules,
not by eyeballing. The gate code (gate.py) and any LLM judge must follow this file. The gold set
(`gold_set_v1.json`) is labelled against this file. Scoring formula, weights and anchors are NOT
touched by this file; it only decides which listings form the top-12 competitor set.

Version: rulebook_v1.8 (2026-10-31; v1 2026-10-28). The v1.8 section overrides v1.7, the v1.7 section overrides v1.6, the v1.6 section overrides v1.5, the v1.5 section overrides v1.4, v1.4 overrides v1.3, the v1.3 section overrides v1.2, and v1.2 overrides any older line it conflicts with. Any change gets a new version line in the changelog at the bottom
and must be re-tested on the fresh holdout list (`holdout_shelves_v1.json`), never only on the gold set.

---

## Global rules (apply to every shelf)

**G1 Hero must be primary.** A listing counts only if the shelf's hero ingredient is the main thing the
product sells.
- **Include — single hero:** the hero is the product (e.g. "Lactoferrin 250 mg").
- **Include — hero-led complex (HERO_LED_COMPLEX):** the hero is first/front-of-bottle and the product is
  named after it, even with helpers added (e.g. "Urolithin A + NMN + Pomegranate + Fiber",
  "Horse Chestnut 20% Aescin with Butcher's Broom").
- **Exclude — hero secondary/tertiary (HERO_SECONDARY):** the hero is one of several ingredients and
  something else leads the title or the product name (e.g. "Leg Veins blend: Butcher's broom, Horse chestnut,
  Gotu kola…", "Red Vine Leaf + Horse Chestnut" where red vine leaf is first, "Mushroom Coffee with Reishi").
- **Exclude — hero missing (EX_HERO_MISSING):** hero not in the product at all (search noise, look-alikes:
  cocoa flavanol powder on the epicatechin shelf unless it is sold as epicatechin; ferritin on lactoferrin).

Tie-break test for G1: *Would a shopper who typed the shelf keyword see this as "a <hero> product"?*
Use the title order, the brand's product name, and the first bullet. Amazon "Primary Supplement Type" /
"Special Ingredients" attributes support the call when present.

**G2 Named form = that form only.** If the keyword names a chemical form (glycinate, bisglycinate,
phytosome, citrate, orotate, R-ALA…), the listing must contain that form as the hero's form.
- Different form only → EX_FORM_MISMATCH (e.g. magnesium citrate on the glycinate shelf).
- Blend of forms where the named form is not the only/lead form → EX_FORM_BLEND (e.g. "Magnesium Complex:
  glycinate, citrate, malate"). A product that is 100% the named form with a non-hero helper
  (e.g. Mg glycinate + lemon balm) passes G2 and is judged under G1.

**G3 Named format = that format only.** If the keyword names a format, only that format counts.
- gummy shelves: gummies only. "Chews", "soft chews", "chewable tablets", powders, capsules → EX_FORMAT_MISMATCH.
  Amazon `Item Form` = Gummy is the deciding field when the title is ambiguous.
- capsule shelves ("… capsules"): capsules, veg caps, softgels and tablets count as "pill"; powders,
  liquids, tea, coffee, gummies do not.
- powder shelves: powder only.
- Format not stated anywhere (title, Item Form) on a format shelf → EX_FORMAT_UNSTATED (low-confidence; re-check PDP).

**G4 Supplements only, for adult humans.**
- Pet products (dogs, cats, horses, also pet brands without a pet word: Dr.Bruce, PetLab, Zesty Paws,
  Vetri-Science…) → EX_PET.
- Infant formula, baby drops marketed for infants → EX_INFANT. (Kids' gummies for children ≥2 are allowed
  unless the shelf says adult.)
- Food, tea, coffee, cooking ingredients, bulk thickeners, noodles/rice, spices sold as food → EX_NOT_SUPPLEMENT.
  Test: is it sold as a dietary supplement (Supplement Facts, servings in caps/gummies/scoops, supplement
  breadcrumb)? "Green tea extract" capsules are a supplement; "green tea bags" are not.
- Creams, serums, sprays for skin → EX_TOPICAL.

**G5 Variants of one product line count once (EX_VARIANT_DUP).** Same brand + same formula, different size,
count, flavour, pack-of-N, or bundle = one line. Keep the listing with the most reviews (ties: best BSR);
the rest are EX_VARIANT_DUP pointing to the kept ASIN. Evidence order: Amazon `variantAsins` (same
variation family) → identical title/brand with only size/flavour/pack words different → same brand with
re-spelled name (e.g. "SP Nutrition"/"Spnutrition", "PURELYNUTRIENT"/"Purely Nutrient").
A brand's genuinely different formulas (MAX vs PLUS, 1000 mg vs 3000 mg with different ingredient lists)
are separate lines.

**G6 Own keyword shelf, or NO_SHELF.** An idea is scored against the shelf of its own keyword. If the idea's
keyword has no measurable Datarova shelf (no clicks / no page-1 listings for that keyword), the idea is
NO_SHELF — never borrow a parent shelf (the Gentle-Iron-from-"iron" retrofit is banned).

**G7 Sponsored listings** count like organic listings if they pass G1–G6 (they compete for the same shopper).

**G8 Evidence priority.** PDP fields (Item Form, Primary Supplement Type, breadcrumbs, variantAsins,
bullets) beat title regex. If PDP and title disagree on format, PDP Item Form wins unless the title
names a specific format that contradicts a generic Item Form (e.g. Item Form "Capsule" but title
"Gummies" → mark low confidence, flag for review).


### rulebook_v1.2 amendments (Gautam rulings 28 Oct R1–R4 + Round 2 29 Oct Q1–Q8). These override the text above where they differ.
**G9 G-NAME (new, Gautam Round 2 Q7).** The hero ingredient must be named on the title or the front packaging to count.
- Front-packaging proxy: the listing TITLE plus the BRAND name (the brand is printed on the front). Bullets, Special Ingredients,
  Primary Supplement Type and the ingredient panel do NOT count: they are back-of-pack facts. (Both of Gautam's exemplars, Florastor
  Gas & Bloat and Solaray CircuLegs, name the hero in bullets and Special Ingredients, and he ruled both OUT.)
- Hero named only in bullets/PDP fields/ingredients → EX_HERO_UNNAMED (out). Hero nowhere → EX_HERO_MISSING.
- Spelling variants count as named: hyphen/space variants ("Rei-shi", "HistaGest-DAO", "Sea Moss"/"Seamoss") and the aliases in the shelf row.
- Variants of one product are judged listing by listing: a line counts if any of its listings names the hero.
- Solaray CircuLegs (horse chestnut) is OUT under G9. This overrides Gautam's earlier Q4 answer and is flagged to him as override-pending.
**G1 additions.**
- Hero-first bundles count (R1): a multi-product bundle whose first-named product is the hero is HERO_LED_COMPLEX.
- Any ingredient named before the hero makes the hero secondary, whether or not it is on a known-ingredient list (e.g. "Red Vine
  Leaf + Horse Chestnut", "Cocoa Flavanols … Epicatechin", "Maral Root … Epicatechin"). A blend/complex/N-in-1/N-herb product named
  before the hero ("Leg Veins 6-Herb Blend with Horse Chestnut", "10 Mushroom Complex with Reishi") is HERO_SECONDARY.
- Brand words are not ingredients or food words ("North American Herb & Spice", "Doctor's Recipes").
**G2 lead-form test (R4 + Q3).** On a named-form shelf a listing passes when the named form is the FIRST form in the title, even if
other forms or an N-in-1 list follow ("Magnesium Glycinate Gummies 500mg, 14-in-1"; "MegaFood Magnesium Glycinate, Malate, Citrate"
are IN). EX_FORM_BLEND when the title calls it a complex/blend of forms ("Magnesium Complex", "Glycinate Complex"), or another form of
the compound is named before the named form. EX_FORM_MISMATCH when the named form is absent.
**G3/G8 format evidence (Q8).** A format named in the title (or, if the title names none, in the bullets) beats the PDP Item Form.
Item Form decides only when title and bullets name no format.
**G4 additions.**
- Kids/toddler-only products → EX_KIDS (R3). All-ages products ("for Adults & Kids", "Women & Kids") COUNT (Q1).
- Culinary gums, thickeners, flours, noodles/rice and other cooking ingredients (e.g. "Konjac Gum Powder") → EX_NOT_SUPPLEMENT.
**G5 product lines (R2 + Q2 + Q5).**
- Same brand + same formula = one product, also under a different product name, size, count, tablet size or bundle (Q5: Blood
  Builder vs Minis, Dulac Diosmin 500 vs Dinaven 500, Nature Made 60 vs 90, Gynable variants, VITASUPPORTMD diosmin bundles).
- Reseller copies that print the same brand/product in the title under another seller's brand field count once (R2: Peehss,
  Perfexin, TUVAAZ, Aaenouicfs selling Purely Nutrient).
- Clones with DIFFERENT brand names count separately even when formula and copy are near-identical (Q2).
- Identical titles (ignoring count/size/pack words) and "N bottles"/"pack of N" listings are one product, unless both carry
  different real brand names.

---

## v1.3 overrides (Gautam Round 3, 29 Oct 2026; overrides anything older)

- **R3-1 N-in-1 / Complex.** "N-in-1 <hero>", "<hero> Complex" and "4-in-1 Complex <hero>" count as HERO_LED_COMPLEX when the hero is the first active named. Bare count words do not lead. A named blend does lead: "N-herb/mushroom/ingredient", "herbal/mushroom/superfood blend", or "<word> Complex" where the word is a real ingredient or name ("Maral Root Complex", "Vein Complex"). Those make the product HERO_SECONDARY.
- **R3-2 Delivery words.** Liposomal, chelated, phytosome, micellar, nano, enteric, buffered, fermented, slow/extended/time-release, sucrosomial, bioactive and absorbable are modifiers. Origin words (Ethiopian, Himalayan, organic, wild, cold-pressed…) and claim words (ultra, max, triple, advanced, pure, high-absorption, full-spectrum, complex, formula…) are modifiers too. None of them lead a title, and on a plain shelf none of them is a form.
- **R3-2 Delivery-named shelf.** If the keyword names a delivery tech (liposomal X, X phytosome), only listings with that tech in the title or brand count. Anything else is EX_FORM_MISMATCH.
- **R3-3** Brand-coined name with no hero in the title or front label → out (EX_HERO_UNNAMED). The PDP never rescues this.
- **R3-4** CircuLegs (horse chestnut 019/089) stays OUT. The override is closed.
- **R3-5 Dose.** Same brand with a different hero dose is TWO products. Same brand with the same dose is one product (Q5): pack sizes, counts, flavours and reseller listings of one product all merge. A per-serving vs per-capsule restatement of the same strength is the same dose.
- **G2 update.** "<form> Complex" (e.g. Magnesium Glycinate Complex) counts. "Magnesium complex/blend" blocks only when it is named before the form. "Complex of", "N forms", and triple/multi-<mineral> block anywhere. Triple, N-in-1 and delivery words are not "other forms".
- **No PDP rescue.** A named form, hero or delivery tech missing from the title (and brand) is not rescued by bullets, ingredients or PDP fields.
- **Exclusion words need context.** Negations ("No Rice Fillers", "without magnesium stearate") never trigger an exclusion. Rice starch/flour as an ingredient is not culinary, and konjac/xanthan gum is culinary only when nothing marks it as a supplement. Topical words after an oral format ("capsules … cream of tartar") are not topical. Pet words need a pet cue with no human cue. Prenatal/maternal/breastfeeding are adult, not infant or kids.

## v1.4 overrides (Gautam Round 4, 29 Oct 2026; overrides anything older)
- **R4-1 Form from the PDP.** On a form-named shelf the form may come from the product page (ingredients "(as <form>)", special-ingredient field, or a bullet that states it as this product's form) as long as the TITLE names the hero. Comparison/general copy ("better than glycinate") does not count. Replaces the form part of R5 no-PDP-rescue; the hero and delivery tech still need the title/brand.
- **R4-2 Benefit words before the hero count.** Brand + benefit/support/body-part/format words ("Vein Support Supplement ... with Horse Chestnut", "Vein Formula Diosmin", "3-in-1 Fiber Capsules, Daily Psyllium") do not lead: the product is HERO_LED_COMPLEX when the hero is the first-named active. Coined product names, N-herb/mushroom blends, "<ingredient> Complex" and any other active named first still make it HERO_SECONDARY. Overrides "Vein Complex" in R3-1.
- **R4-3 Per-unit dose.** Normalise dose per unit before comparing (300 mg per 3 caps = 100 mg/cap; 5 g = 5000 mg; "per serving" is matched to a per-unit dose when the serving holds a whole number of units). Different wording for the same per-unit dose is ONE product.
- **Bundles.** Hero-first bundles only: a bundle that names another product (with its own count/size) before the hero is HERO_SECONDARY (e.g. "Stamets 7 (120 ct) & Turkey Tail").
- **Humans & Pets.** "for Humans & Pets" / human + pet bundles are all-ages, not EX_PET (Q1 all-ages rule). Pet-only stays EX_PET.
- **Glyphs.** Curly apostrophes/quotes and Unicode dashes are normalised before any test ("Lion’s" = "Lion's").
- **Sold-unit format.** A title that states the sold unit with a count ("60 Capsules", "120 Tablets") is that format even if it calls the contents a powder (psyllium "Husk Powder ... 60 Capsules" is a capsule).

## v1.5 overrides (Gautam Round 5, 29 Oct 2026; overrides anything older)
- **R5-1 Hero + one vitamin.** "Iron-C", "<hero> with Vitamin C": the hero leads, the vitamin is a co-active → HERO_LED_COMPLEX (counts).
- **R5-2 Format split.** Same brand, capsules vs powder (or any two formats) are TWO products on a plain shelf. If the shelf names a format, only that format counts.
- **R5-3 Prominence.** A multi-strain/blend product counts when the hero is in the title early or on the front of pack ("Metabolic Daily – Multi-Strain Probiotic with Akkermansia", "GLP-1 Probiotic+, Akkermansia"). A branded base product "<coined name> with <hero>" (CamelCase or ™/® name, e.g. "UltraFlora Triplebiotic with Akkermansia") is HERO_SECONDARY.
- **R5-4 Not a supplement.** Beverages/aperitifs/mocktails/non-alcoholic spirits, and bulk culinary single-herb powders (no dose, grocery category or "perfect for teas/coffee/smoothies" copy) are EX_NOT_SUPPLEMENT.
- **Mineral form blends.** "Tri-/Triple/Multi-<mineral>" (chromium, zinc, magnesium, iron, calcium, selenium, copper) on a form-named shelf = EX_FORM_BLEND unless the shelf form is named before it (NOW Tri-Chromium is out on chromium picolinate).
- **Settled by existing rules:** "<abbrev> Mushroom Complex … 50mg <hero>" counts when the hero is the only dosed active; "Green Tea Leaf EGCG" in a capsule title is an ingredient, not a tea; a pet category alone (no pet word in the title) does not make a human product EX_PET; same brand + one name contained in the other (reseller tails) = one product.

## v1.6 overrides (Gautam Round 6, 30 Oct 2026; overrides anything older)
- **R6-1 Coined name + hero.** "<Coined name> with <hero>" is HERO_SECONDARY only when the label/ingredients show a broader base formula (e.g. UltraFlora probiotic). If the hero is the sole or lead active, it counts ("Histamine Digest PureMAX with DAO" counts).
- **R6-2 Organic.** Organic vs non-organic of the same brand are TWO products (different formula), even inside one Amazon variant family. "Better than organic" is not an organic claim.
- **R6-3 Dosed hero after a named complex.** "Complete Beauty Complex with 5000mcg Biotin" counts (HERO_LED_COMPLEX): the hero carries its own dose.
- **Whole food / bulk (R5-4 settled).** Dried fruit (dried/sour/tart cherries by the oz/lb), whole or cooking seeds, and cut & sifted / loose bulk herb by the lb, with no per-serving dose and no capsule/tablet/gummy, are EX_NOT_SUPPLEMENT. A liquid extract/tincture whose title says "dried root" is a supplement (the words describe the source herb).
- **Carrier / massage oils** are EX_TOPICAL.
- **Settled by existing rules:** "120 ct" + capsule Item Form = capsules even if a bullet says "mushroom powder"; "(2 Pack)", "Pack of 3", "x2" of the same brand/dose/format = one product (G5); an ingredient named before the hero that is the hero's source ("orange peel extract providing 450 mg diosmin") or has the smaller paired dose ("Hesperidin Diosmin 50mg/450mg") does not lead; a hero listed undosed only after the count among 2+ other actives ("Sleep Mushroom Capsules, 90 Count, Reishi, GABA, L-Theanine, Melatonin") is HERO_SECONDARY (R5-3 prominence).

## v1.7 overrides (NPD settles from existing rules, 30 Oct 2026; overrides anything older; no new Gautam ruling)
- **Source-qualified hero.** A word right before the hero that names its source ("Broccoli Sulforaphane", "Broccoli Sprout Sulforaphane", "X Root Y") is not an earlier ingredient; the hero leads. Two separate actives side by side ("Ashwagandha Maca", "Zinc Copper") are still two ingredients.
- **Kids-only (Q1 restated).** EX_KIDS only when the product is kids-only. A title "Kids 4+" whose directions give adult dosing ("Adults take 2 gummies; children take 1") is all-ages and counts. "for kids and adults" marketing copy alone is not adult dosing.
- **Pill beats powder.** "Root Powder Capsules" = capsules. A title with no format word, Item Form = Capsule/Tablet/Softgel/Gummy and bullets that name that unit is that format, even if a bullet says "maca powder" (contents).
- **Tea.** A tea word inside a capsule/tablet/gummy title ("Saw Palmetto Capsules with Maca, Green Tea, Ginger") is a helper ingredient, not a tea format. A "tea powder" sold in supplement servings or called a supplement (no tea bags / brew / loose leaf) is a supplement powder.
- **Whole food singular.** "Seed Whole - Bulk 1 lb", "whole seed", and a bulk single-herb powder by the lb with no dose, servings or supplement word are EX_NOT_SUPPLEMENT (R5-4).
- **R6-1 broader base, label lead.** "<Coined product name> with/+ <hero>" (e.g. "G-Curve with Maca Root", "Active Immunity+Elderberry") is HERO_SECONDARY when the label's first/lead active is another ingredient (vitamin C 180 mg; horny goat weed). A label with 8+ dosed actives where the hero is one of the list is a broader base formula too. A benefit-descriptor name ("Food Sensitivity Relief with DAO", "Hair Skin and Nails with Biotin 2500 mcg") follows R6-1/R6-3 as before.
- **Form shelf, label compound (settled by NPD from R3/R4 form-shelf rule).** On a form-named shelf (e.g. copper bisglycinate) a generic "Chelated" title word does not override the label: if the label names a different compound (cuprous nicotinate / cuprous nicotinic acid) it is EX_FORM_MISMATCH. A generic "amino acid chelate" label stays consistent with a "chelate" title.

## v1.8 overrides (Gautam Round 7 + NPD settles, 31 Oct 2026; overrides anything older)
- **R7-1 label lead by dose (Gautam).** When the label's lead active is a different ingredient with a higher dose than the hero, the product is HERO_SECONDARY, even if the title names and doses the hero, whatever the number of actives or name words (OLLY Goodbye Stress: GABA 100 mg leads, L-theanine 50 mg = out on L-theanine gummies). Vitamins/minerals listed first by label convention, blends, and the hero's own source material (e.g. "BroccoRaphanin (broccoli seed)") are not a different lead; activity-unit heroes (HDU/CFU/IU) and vitamin/mineral shelves are not compared by mg. An undosed label: "<coined name> with/+ <hero>" whose label lists another active first = HERO_SECONDARY (Jarrow QH-Absorb + PQQ).
- **Misspelled hero (NPD-settled).** A misspelled hero name ("Ginko", "Donq Quai") names the hero.
- **Branded ingredient (NPD-settled).** A trademark ingredient that the label says is the hero ("5-Loxin (standardized extract of Boswellia serrata)") is the hero, not an earlier ingredient.
- **Descriptors (NPD-settled).** "5in1", "Extract", "Standardized", "Organic" etc. before the hero are not ingredients.
- **"X Free" (NPD-settled).** "Melatonin Free" / "X-Free" / "No X" means the product does not contain X.
- **Whole root with a dose (NPD-settled).** "Whole Root" with a per-capsule mg dose ("Dong Quai Root 550mg ... Whole Root ... 180ct") is a dosed supplement, not bulk.

## v1.9 overrides (Gautam Round 8 + NPD settles, 1 Nov 2026; overrides anything older)
- **R8-1 coined name containing the hero word (Gautam).** A made-up name that contains the full hero word ("TheraZinc") names the hero when the hero leads the label (Quantum TheraZinc counts on zinc gluconate). Refines R3-3: coined names with no full hero word ("Saccharomycin", "OptiFerin-C") still do not name the hero.
- **R7-1 helpers (NPD-settled).** When picking the label lead, skip enzyme helpers, carriers and cofactors (mustard seed powder as a myrosinase source, digestive enzymes, black pepper / piperine / BioPerine, MCT or carrier oils, lecithin). The lead is the first remaining active.
- **Herb names are not pets (NPD-settled).** Pet words inside a herb name ("Cat's Claw", "Cats Claw", horsetail, horse chestnut, horseradish, dogwood, catnip) are not pet signals.
- **Animal products (NPD-settled).** Horse / equine / pony products are EX_PET. A Pet Supplies category plus bullets aimed at animals ("for horses", "equine supplement", "mix with daily feed") is EX_PET.
- **Homeopathic (NPD-settled).** Homeopathic products are not supplements: "Homeopathic" or HPUS on the title or label, or a potency such as 6C / 30C / 2X HPUS, or homeopathic pellets = EX_NOT_SUPPLEMENT. The Amazon category "Single Homeopathic Remedies" alone is not a signal.
- **No supplement signal (NPD-settled).** A listing with no ingredient panel, outside health/grocery categories and with no supplement, dose or oral-unit word (fence staples, nail tips, charts) = EX_NOT_SUPPLEMENT.
- **Bulk herb-part powder (NPD-settled, R5-4).** "Root/Leaf/Herb/Bark/Seed/Berry Powder" sold by weight (4 oz, 1 lb, 50 g pouch) with no dose, servings, extract or capsule word = EX_NOT_SUPPLEMENT.
- **Root descriptors with a dose (NPD-settled).** "Dried Root", "Whole Root", "Cut & Sifted" etc. with a per-capsule mg dose or a counted capsule/tablet unit ("120 Capsules") is a supplement, not bulk.
- **Multi-mineral titles on a form shelf (NPD-settled).** A form word attached to another mineral ("Copper Gluconate") is that mineral's form. The hero mineral's own form comes from its own label wording ("Zinc L-methionine"); a different form = EX_FORM_MISMATCH.
- **Pack counts (NPD-settled, G5).** Same brand (incl. "NOW" vs "NOW Foods"), same product name and same dose in different pack counts (100 vs 500 tabs) = one line.

## v2.0 overrides (Gautam Round 9 + NPD settles, 1 Nov 2026; overrides anything older)
- **R9-1 low-dilution nutrient homeopathics (Gautam).** A homeopathic-labelled product whose active is a real nutrient at a low X dilution (1X-3X) or with a material mg/mcg dose counts (Cold-EEZE zinc gluconate 2X HPUS, 13.3 mg zinc = IN on zinc gluconate). Classic high-dilution homeopathics (C potencies such as 6C/30C, X above 3X, pellets/globules, Boiron-style) stay EX_NOT_SUPPLEMENT. Refines the v1.9 homeopathic settle.
- **Hero from the label lead (NPD-settled, R4-1 principle).** A title naming the hero ingredient in a shorter form ("Pure Kidney Bean Extract") counts when the label lead is the full hero ("White Kidney Bean Extract") - Maximum Slim counts on white kidney bean.
- **Whole foods (NPD-settled).** Groceries (canned/dried beans, fresh roots, spices, foods with a Nutrition Facts panel) with no supplement signal (no supplement word, oral unit, unit count, dose or supplement directions) = EX_NOT_SUPPLEMENT.
- **Category vs directions (NPD-settled).** A grocery or herbal-tea Amazon category does not make a product a non-supplement when the title names a supplement form (extract, drops, tincture, capsules) and the label gives supplement use ("As a dietary supplement take 1 serving", dropper dosing).
- **Form blends in one clause (NPD-settled).** On a form shelf, "<Mineral> (as A, B)" naming several compounds counts only when the shelf form is the lead: the title leads with it (Gautam R2-Q3) or it is the first compound in the clause; otherwise EX_FORM_BLEND. "Glycinate amino acid chelate" is one compound.
- **Another mineral leads (NPD-settled).** On a mineral shelf, a different mineral named before the hero in the title and leading the label ("Magnesium Citrate 500mg, with Zinc") = HERO_SECONDARY.
- **Formula names before "with <hero>" (NPD-settled, R6-1).** A formula/support name or a benefit word + Complex ("Adrenal Support Formula with", "Brain IQ Complex with") is not an ingredient: the product counts when the hero leads the label (vitamins/minerals and helpers skipped). N-herb/mushroom blends, "<ingredient> Complex", powders and coined names still lead (R3-1, R4-2).
- **Hero synonym words (NPD-settled).** A word that is part of a multi-word hero synonym ("Ginseng" in "Siberian Ginseng" on eleuthero) or of the brand is not another herb.
- **R7-1 applied (NPD-settled).** OLLY Sleep (L-theanine 100 mg leads melatonin 3 mg) is out on melatonin gummies.

## v2.1 overrides (Gautam Round 10 + NPD settles, 1 Nov 2026; overrides anything older)
- **R10-1 equal-billed N-in-1 (Gautam).** An equal-billed 2-in-1 / 3-in-1 (or "Pre Pro Post") whose title names the hero as one of its co-equal actives counts, even if another active is first on the label (Goli Pre Pro Postbiotic = IN on probiotic gummies). Exception to R7-1; R7-1 still applies when the hero is a minor add-in ("... with <hero>"). NPD application: "Phosphatidylserine & Bacopa Monnieri ... 2 in 1" counts on bacopa.
- **R7-1 applied (NPD-settled).** Planetary Herbals Pau d'Arco (burdock-led blend leads the label) = HERO_SECONDARY.
- **Lead form applied (NPD-settled).** Life Extension Zinc Caps "Zinc Citrate" with zinc monomethionine first on the label = EX_FORM_BLEND.
- **R6-1 applied (NPD-settled).** "Organic Immune Support with Pau D'Arco" with no label and a description led by garlic/vitamins = HERO_SECONDARY.
- **Vitamins/minerals in the label lead (NPD-settled, general).** Vitamins A/C/D/E/K/B-group and minerals are skipped when finding the label lead for a coined/formula name + hero ("Eye Vitamins with Bilberry" = IN when bilberry is the first other active), unless a skipped vitamin/mineral out-doses the hero (R7-1; OLLY Active Immunity+Elderberry stays HERO_SECONDARY).
- **Co-named earlier active (NPD-settled).** "<X> & <hero>" where X is its own label active ("Lutein & Bilberry") = X is an earlier active, not a "source of hero" = HERO_SECONDARY.
- **Fiber and Multi are actives (NPD-settled).** Fiber, inulin, psyllium, "Multi", "Multivitamin" named before the hero are other actives (Metamucil/Benefiber fiber gummies, OLLY Multi + Probiotic = HERO_SECONDARY / out) unless the hero is itself a fiber.
- **Misspellings (NPD-settled).** A real dictionary word is never read as a misspelled hero (prebiotic / postbiotic are not probiotic); fuzzy matching applies only to non-dictionary tokens.
- **Salt carriers (NPD-settled).** A mineral salt of an organic active ("magnesium caprylate") counts as that active (caprylic acid) when finding the label lead (Candida Support, Yeast Cleanse = HERO_SECONDARY on pau d'arco).
- **Apostrophes (spec hygiene).** Hero names match with or without an apostrophe, a curly quote or a space after it ("Pau D' Arco", "Pau D’ Arco", "St John's"); every holdout spec hero is apostrophe-tolerant.

## v2.2 overrides (Gautam Round 11 + NPD settles, 1 Nov 2026; overrides anything older)
- **R11-1 trademark ingredient names (Gautam).** A trademarked hero-ingredient name names the hero (and its form), even when the generic word is missing from the title: ChromeMate = chromium polynicotinate (Pure Encapsulations ChromeMate GTF 600, Klaire Labs Chromemate = IN on chromium polynicotinate), 5-Loxin = boswellia. Refines R3-3/R8-1: a coined PRODUCT name with no hero word still does not name the hero; a trademarked INGREDIENT name in the table below does. The label must still show that ingredient leading (R7-1).
- **GTF (NPD-settled).** "GTF" / "glucose tolerance factor" is a descriptor of chromium polynicotinate (niacin-bound chromium), not a different chromium form.
- **R5-3 applied (NPD-settled).** NuEthix SLIN-Trol "Glucose Disposal Agent ... with Chromium Polynicotinate, & Glycine" = HERO_SECONDARY (chromium is an add-in to a coined formula; no label panel). An amino acid or excipient (glycine, taurine, cellulose...) named next to the hero is never the "label lead" of such a formula.
- **Personal care (NPD-settled from the topical rule).** Body wash, face wash, toner, cleanser, serum, lotion, shampoo, conditioner, soap, cream, mask, scrub, moisturizer, balm, deodorant = EX_TOPICAL, unless the title is clearly an oral supplement ("Skin Support Capsules", gummies, tablets).
- **Bulk (R5-4 applied, NPD-settled).** "Root Cut", "Cut & Sifted", "<herb> Powder - 1 lb" and weight-only pouches (oz/lb/g with no count and no per-serving mg dose) of a plain herb = EX_NOT_SUPPLEMENT. Extracts, capsules and dosed powders are not bulk.
- **Spec hygiene.** Holdout shelf specs never list trademark names as the hero or form (the trademark table does that), and never list descriptors (GTF) or the shelf form as "other forms". A spec lint runs before every freeze.

### Trademark ingredient table (R11-1; trademark | hero | form)
| Trademark | Hero | Form |
|---|---|---|
| ChromeMate | chromium | polynicotinate |
| Chromax | chromium | picolinate |
| 5-Loxin | boswellia | — |
| ApresFlex / AprèsFlex | boswellia | — |
| KSM-66 | ashwagandha | — |
| Sensoril | ashwagandha | — |
| Shoden | ashwagandha | — |
| Albion | — | bisglycinate chelate |
| TRAACS | — | bisglycinate chelate |
| Ferrochel | iron | bisglycinate |
| OptiZinc | zinc | monomethionine |
| PepZin GI | zinc | carnosine |
| Meriva | curcumin | phytosome |
| Longvida | curcumin | — |
| BCM-95 | curcumin | — |
| Theracurmin | curcumin | — |
| BioPerine | black pepper piperine | — |
| Setria | glutathione | — |
| Quatrefolic | folate | methylfolate |
| Metafolin | folate | methylfolate |
| Magtein | magnesium | threonate |
| Cognizin | citicoline | — |
| Suntheanine | l-theanine | — |
| PharmaGABA | gaba | — |
| Sunfiber | guar fiber | — |
| Pycnogenol | pine bark | — |
| Ester-C | vitamin c | ascorbate |
| FloraGLO | lutein | — |
| AstaReal | astaxanthin | — |
| Superba | krill oil | — |
| Mitopure | urolithin a | — |
| PACran | cranberry | — |
| Capros | amla | — |
| PrimaVie | shilajit | — |
| Creapure | creatine | monohydrate |
| CarnoSyn | beta-alanine | — |
| Kaneka QH | coq10 | ubiquinol |
| Affron | saffron | — |
| Wellmune | beta glucan | — |
| Berbevis | berberine | phytosome |

## v2.3 overrides (hybrid gate v11.0, 1 Nov 2026; general fixes from v10.0 misses under existing rules; no new Gautam ruling; overrides anything older)
- **Three-way calls (Gautam, 1 Nov 2026: "Switch to rules plus model").** The gate calls each listing IN, OUT or UNSURE. Rules decide when the signals agree. UNSURE (signals conflict, label missing/partial with a formula-style title, lead active unclear, form or category ambiguous) goes to a model judge that reads the shelf spec, the listing and the full GAUTAM_DECISIONS file and returns IN/OUT with a rule ID.
- **R7-1 by dose (applied).** On a plain shelf, a different, non-vitamin/mineral active dosed higher than the hero on the label makes the hero secondary. Settled by rules only when the title is formula-named (formula/stack/blend/complex/booster) without naming that active and the dose is at least 2x the hero; every other higher-dose case is UNSURE (judge).
- **Saline laxatives (applied, R5/topical-medicine rule).** "Oral Solution" or a liquid sold as a "Laxative" = EX_NOT_SUPPLEMENT unless the title says dietary supplement.
- **Co-named earlier active (v2.1, applied).** "<X> and/&/+ <hero>" where X is a real active (not a dictionary word, brand, or origin/varietal adjective) and the hero is not named earlier = HERO_SECONDARY (e.g. "Muira Puama and Catuaba").
- **Origin/varietal adjectives are not actives.** German, Roman, Siberian, Korean, Ceylon, wild ... before the hero do not make it secondary ("German and Roman Chamomile" = IN).
- **Category vs directions (v2.0, applied).** A grocery/tea category does not exclude a standardised extract (ratio such as 4:1, a % standardisation other than 100%, or "extract") whose label lists only the hero.
- **N-in-1 counts and benefit words (applied).** An "N-in-1" count plus benefit words before the hero do not make it secondary when the label lead (after vitamins/minerals and trace elements) is the hero and no other active is named in that phrase = HERO_LED_COMPLEX.
- **Serving in the copy (R5-4, applied).** A powder whose bullets/label state a serving (e.g. "3 g per serving", "Servings Per Container 75") is dosed, not bulk.
- **R12-1 precursor pair (Gautam, "MagicMag: count").** On a form shelf for a salt (citrate, malate, gluconate ...), a powder whose label lists the mineral's carbonate/oxide/hydroxide plus the matching acid and is sold as that form counts as that form = IN_OK.

## v2.4 overrides (Gautam Round 12–13, 2–3 Nov 2026; gate v11.1; overrides anything older)
- **R12-1 precursor pair (Gautam).** A powder sold as the hero salt whose label lists the precursors that form that salt in water (e.g. magnesium carbonate + citric acid sold as magnesium citrate) counts on that salt's form shelf.
- **R13-1 vitamins/minerals first on the label (Gautam).** When the hero leads the title of a hero-plus-vitamins/minerals product, it counts even when the supplement-facts panel lists the vitamins and minerals first. R7-1 still applies when a different botanical or active leads.
- **R13-2 classical formula (Gautam).** A classical named formula whose name includes the hero (Ayurvedic or TCM named formulas, e.g. "[hero] Guggulu") counts even when another ingredient leads the label. R7-1 still applies to non-classical blends.
- **R13-3 derivative (Gautam).** A derivative compound of the hero (e.g. dihydro-, tetrahydro-, hydroxy-, acetyl- + hero) is its own shelf and is OUT (HERO_SECONDARY) on the parent hero's shelf.
- **R13-4 softgels and carrier oils (Gautam).** Softgels count on a capsules shelf. Carrier oils and fats (MCT oil, olive oil, lecithin, saturated-fat nutrition rows) are not actives and never "lead" a label under R7-1.
- **R13-5 "X & hero" 2-in-1 (Gautam; extends R10-1).** A 2-in-1 title "X & [hero]" (exactly two named actives billed as a pair) counts as equal billing even when X is named first and there is no label on the listing. A longer list, or a hero-only title over a blend led by another active, is still R7-1.
- **R13-6 hero first on the label (Gautam).** The hero listed first on the label and named alone in the title counts even if a later active has a higher dose. R7-1 bites only when another active LEADS the label (or is named before the hero in the title).
- **Non-supplement / topical (Gautam, v11.1 brief 3 Nov; consistent with the Round 13 NPD settles).** Seeds sold for planting, juice or beverage shots, and room/linen sprays are EX_NOT_SUPPLEMENT; salves and essential oils sold for aromatherapy or topical use are EX_TOPICAL. Judge the listing as a whole, not one word: an oral supplement oil, resin, paste or spray with a serving counts.
- **Misspellings (NPD clarification, not a Gautam ruling).** A misspelt or closed-compound spelling of the hero (e.g. "Shialjit", "Hornygoatweed", "Kuzu") still names the hero; a different word that merely looks similar does not.

## Reason codes

| Code | In/Out | Meaning |
|---|---|---|
| IN_OK | in | Single-hero product that meets form/format rules |
| HERO_LED_COMPLEX | in | Hero leads; helpers added |
| HERO_SECONDARY | out | Hero is a minor/secondary ingredient |
| EX_HERO_MISSING | out | Hero not present |
| EX_FORM_MISMATCH | out | Wrong chemical form |
| EX_FORM_BLEND | out | Named form only part of a form blend |
| EX_FORMAT_MISMATCH | out | Wrong format (e.g. chews on a gummy shelf) |
| EX_FORMAT_UNSTATED | out | Format shelf, format not stated |
| EX_PET | out | Pet product |
| EX_INFANT | out | Infant product |
| EX_NOT_SUPPLEMENT | out | Food/tea/coffee/ingredient |
| EX_TOPICAL | out | Skin/topical |
| EX_VARIANT_DUP | out | Another listing of an already-counted product line |
| EX_KIDS | out | Kids/toddler-only product (v1.1, R3) |
| EX_HERO_UNNAMED | out | Hero not named on title or brand name (v1.2, G9 G-NAME) |

---

## Shelf specs (gold shelves)

Clicks = Datarova US search clicks for the keyword, Sep 2026 (monthly). Source:
`datarova_shelf_cands_2026-10-28.json` and `pdp_2026-10-28/datarova_gold_extra_2026-09.json`.

| # | Shelf keyword | Clicks (Sep-26) | Hero (aliases) | Form | Format | Shelf-specific exclusions / notes |
|---|---|---|---|---|---|---|
| 1 | magnesium glycinate gummies | 70,163 | magnesium | glycinate / bisglycinate only | gummy | Mg complex gummies (citrate+glycinate…) = FORM_BLEND; capsules/powders = FORMAT; Mg gly + lemon balm/ashwagandha gummies: G1 test |
| 2 | creatine gummies | 119,034 | creatine (monohydrate, HCl) | any creatine form | gummy | "chews"/"soft chews"/"chewables" = FORMAT; flavours of one line = VARIANT_DUP |
| 3 | sea moss gummies | 57,970 | sea moss / Irish moss (Chondrus) | — | gummy | "16-in-1 sea moss + bladderwrack + burdock" = hero-led complex (sea moss first); capsules/gel = FORMAT; re-spelled brands = VARIANT_DUP |
| 4 | iron bisglycinate | 20,735 | iron | bisglycinate / glycinate / Ferrochel | any | sulfate, fumarate, gluconate, carbonyl, heme, polysaccharide = FORM_MISMATCH; iron + C + B12 with bisglycinate lead = hero-led complex; prenatal multis = HERO_SECONDARY |
| 5 | magnesium glycinate | 430,837 | magnesium | glycinate / bisglycinate | any | Mg complex (3-in-1, 7-in-1) = FORM_BLEND; Mg glycinate + lemon balm/L-theanine sleep combos = G1 test |
| 6 | urolithin a | 22,558 | urolithin A (Mitopure) | — | any | Hero-led complexes (UA + NMN/pomegranate/fiber) IN; pomegranate-only "urolithin precursor" = HERO_MISSING; skincare = TOPICAL |
| 7 | horse chestnut extract | 2,074 | horse chestnut / aescin / escin | — | any | Multi-herb vein blends where HC is not first/name = HERO_SECONDARY (Leg Veins, red-vine-leaf-first); creams/gels = TOPICAL |
| 8 | glucomannan | 4,173 | glucomannan / konjac root | — | any | konjac noodles/rice/jelly/gum powder for cooking = NOT_SUPPLEMENT; glucomannan capsules/powders sold for fullness = IN |
| 9 | epicatechin | 1,705 | (-)-epicatechin | — | any | cocoa flavanol powders/cacao = HERO_MISSING unless sold as epicatechin; multi-herb anabolic stacks (Maral root etc.) where epicatechin not lead = HERO_SECONDARY; liposomal 1/2-bottle packs = VARIANT_DUP |
| 10 | lactoferrin | 26,361 | lactoferrin (also "laktoferrin") | — | any | infant formula = INFANT; pet = PET; ferritin/iron = HERO_MISSING; colostrum with lactoferrin listed second = HERO_SECONDARY |
| 11 | thymoquinone | 2,904 | thymoquinone / black seed / nigella / black cumin / kalonji | — | any | black seed oil capsules/liquid count (thymoquinone is its marker); culinary seeds/oil for cooking = NOT_SUPPLEMENT; oregano+black seed combos: G1 test; skincare/hair oil = TOPICAL |
| 12 | saccharomyces boulardii | 9,348 | S. boulardii | — | any | multi-strain probiotics where boulardii is one of many = HERO_SECONDARY; boulardii + MOS/prebiotic with boulardii lead = hero-led complex |
| 13 | dao enzyme | 9,229 | DAO / diamine oxidase (HistDAO, Umbrellux, DAOSin) | — | any | antihistamine herb blends without DAO = HERO_MISSING; digestive enzyme multi-blends with DAO minor = HERO_SECONDARY |
| 14 | diosmin | 6,302 | diosmin (MPFF, diosmin+hesperidin) | — | any | diosmin + hesperidin (MPFF) = IN_OK/complex; horse chestnut-led vein blends = HERO_SECONDARY; "green tea extract" helper does NOT make it a tea |
| 15 | reishi mushroom capsules | 2,394 | reishi / Ganoderma (also "rei-shi", "lingzhi") | — | pill (capsule/tablet/softgel) | mushroom coffee/tea/powder/tincture = FORMAT or NOT_SUPPLEMENT; 10-mushroom blends where reishi not lead = HERO_SECONDARY |


## Shelf specs (holdout shelves, rulebook v1.2; written from the keyword only, before any listing was pulled)
Used for the addendum-5 blind holdout test. Clicks not looked up (G6 not under test for these rows).

| # | Shelf keyword | Clicks | Hero (aliases) | Form | Format | Shelf-specific exclusions / notes |
|---|---|---|---|---|---|---|
| H1 | ashwagandha gummies | n/a | ashwagandha / withania / KSM-66 / Sensoril | — | gummy | capsules, powders, chews, drinks = FORMAT; sleep/stress blends where another herb leads = HERO_SECONDARY |
| H2 | fisetin | n/a | fisetin | — | any | senolytic stacks where quercetin or another active leads = HERO_SECONDARY; skincare = TOPICAL |
| H3 | magnesium l-threonate | n/a | magnesium | L-threonate / Magtein | any | other magnesium forms only = FORM_MISMATCH; magnesium complex/N-form blends where threonate is not the lead form = FORM_BLEND |
| H4 | nattokinase | n/a | nattokinase / NSK-SD | — | any | serrapeptase-led or multi-enzyme blends where nattokinase is not lead = HERO_SECONDARY; natto food = NOT_SUPPLEMENT |
| H5 | nmn | n/a | NMN / nicotinamide mononucleotide | — | any | NR (nicotinamide riboside), NAD+ or NADH without NMN = HERO_MISSING; skincare = TOPICAL |
| H6 | quercetin phytosome | n/a | quercetin | phytosome / Quercefit | any | plain quercetin (dihydrate, anhydrous, liposomal without phytosome) = FORM_MISMATCH; quercetin + bromelain etc. judged under G1 |
| H7 | spermidine | n/a | spermidine (wheat germ extract sold as spermidine) | — | any | wheat germ products not sold as spermidine = HERO_MISSING |
| H8 | zinc picolinate | n/a | zinc | picolinate | any | other zinc forms only (gluconate, citrate, bisglycinate, oxide…) = FORM_MISMATCH; multivitamins = HERO_SECONDARY |

## Shelf specs (holdout shelves, rulebook v1.3; written from the keyword only, before any listing was pulled; seed 20261031)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H9 | lions mane capsules | mushroom | lion's mane / hericium | — | capsule/tablet | mushroom blends where another mushroom or "N-mushroom" leads = HERO_SECONDARY; powders, gummies, coffee, tinctures = FORMAT |
| H10 | inositol | n/a | inositol (myo / d-chiro) | — | any | PCOS blends where another active leads = HERO_SECONDARY |
| H11 | psyllium husk capsules | fiber | psyllium / ispaghula | — | capsule/tablet | powders and wafers = FORMAT; multi-fiber blends where psyllium is not lead = HERO_SECONDARY |
| H12 | astaxanthin | n/a | astaxanthin | — | any | krill oil where astaxanthin is a minor part = HERO_SECONDARY; skincare = TOPICAL |
| H13 | turkey tail mushroom capsules | mushroom | turkey tail / trametes / coriolus | — | capsule/tablet | as H9 |
| H14 | apigenin | n/a | apigenin | — | any | sleep stacks where magnesium/theanine leads = HERO_SECONDARY |
| H15 | liposomal glutathione | n/a | glutathione | delivery: liposomal | any | non-liposomal glutathione (reduced, S-acetyl, Setria without liposomal) = FORM_MISMATCH (R3-2 delivery shelf) |

## Shelf specs (holdout shelves, rulebook v1.4; written from the keyword only, before any listing was pulled; seed 20261101)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H16 | black ginger | n/a | black ginger / Kaempferia parviflora | — | any | plain ginger (Zingiber) with no black ginger = HERO_MISSING; stacks where another herb leads = HERO_SECONDARY |
| H17 | tongkat ali | n/a | tongkat ali / Eurycoma longifolia / LongJack | — | any | testosterone stacks where another active leads = HERO_SECONDARY; coffee/tea = NOT_SUPPLEMENT |
| H18 | ergothioneine | n/a | ergothioneine | — | any | mushroom blends or multi-actives where ergothioneine is not first = HERO_SECONDARY |
| H19 | akkermansia | probiotic | Akkermansia muciniphila | — | any | multi-strain probiotics where another strain or a CFU blend leads = HERO_SECONDARY |
| H20 | nac | n/a | NAC / N-acetyl cysteine | — | any | GlyNAC or glutathione stacks where glycine/glutathione leads = HERO_SECONDARY; effervescent drink mixes count unless sold as a drink |
| H21 | chromium picolinate | mineral | chromium | picolinate (Chromax) | any | other chromium forms only (polynicotinate, chloride, GTF…) = FORM_MISMATCH; form may come from the PDP (R4-1); multi-minerals / berberine stacks where another active leads = HERO_SECONDARY |
| H22 | melatonin gummies | n/a | melatonin | — | gummy | tablets, capsules, liquids, chews, sprays = FORMAT; kids-only = EX_KIDS; sleep blends where another active leads = HERO_SECONDARY |

Other shelves already in gate.py (63) follow the same globals; their hero/form/format regexes live in
`gate.py` `SH`. They get a written row here when they are next labelled.

---

## Shelf specs (holdout shelves, rulebook v1.5; written from the keyword only, before any listing was pulled; seed 20261102)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H23 | fenugreek | n/a | fenugreek / Trigonella / Testofen / Furosap | — | any | testosterone or lactation stacks where another active leads = HERO_SECONDARY; bulk culinary seed/powder (no dose) and teas = NOT_SUPPLEMENT |
| H24 | nettle root | n/a | nettle / Urtica | — | any | plant part is not a form on this plain shelf; prostate stacks where saw palmetto or another herb leads = HERO_SECONDARY; teas = NOT_SUPPLEMENT |
| H25 | rhodiola | n/a | rhodiola / roseroot / golden root | — | any | adaptogen stacks where ashwagandha or another active leads = HERO_SECONDARY |
| H26 | tart cherry | n/a | tart cherry / Montmorency / sour cherry | — | any | ready-to-drink juice and dried fruit = NOT_SUPPLEMENT (R5-4); sleep/uric-acid stacks where another active leads = HERO_SECONDARY |
| H27 | cordyceps capsules | mushroom | cordyceps / militaris / CS-4 | — | capsule/tablet | mushroom blends where another mushroom or "N-mushroom" leads = HERO_SECONDARY; powders, gummies, coffee, tinctures = FORMAT |
| H28 | zinc bisglycinate | mineral | zinc | bisglycinate / glycinate / chelate | any | other zinc forms only (picolinate, citrate, gluconate, oxide…) = FORM_MISMATCH; form may come from the PDP (R4-1); multi-minerals where another active leads = HERO_SECONDARY |
| H29 | biotin gummies | n/a | biotin / vitamin B7 | — | gummy | capsules, tablets, liquids, chews = FORMAT; kids-only = EX_KIDS; hair-skin-nails blends where another active leads = HERO_SECONDARY |

## Shelf specs (holdout shelves, rulebook v1.6; written from the keyword only, before any listing was pulled; seed 20261103)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H30 | black cohosh | n/a | black cohosh / Actaea / Cimicifuga | — | any | menopause stacks where another active leads = HERO_SECONDARY; teas and bulk dried root = NOT_SUPPLEMENT |
| H31 | maca root capsules | n/a | maca / Lepidium meyenii | — | capsule/tablet | powders, gummies, liquids, coffee = FORMAT; stacks where another active leads = HERO_SECONDARY |
| H32 | saw palmetto | n/a | saw palmetto / Serenoa | — | any | prostate or hair stacks where another active leads = HERO_SECONDARY; shampoos/serums = TOPICAL; bulk dried berries = NOT_SUPPLEMENT |
| H33 | sulforaphane | n/a | sulforaphane / glucoraphanin / broccoli sprout or seed | — | any | sprouting seeds and food powders with no dose = NOT_SUPPLEMENT; stacks where another active leads = HERO_SECONDARY |
| H34 | milk thistle | n/a | milk thistle / silymarin / Silybum / silybin | — | any | liver stacks where another active leads (e.g. TUDCA, NAC first) = HERO_SECONDARY; teas and whole seeds = NOT_SUPPLEMENT |
| H35 | copper bisglycinate | mineral | copper | bisglycinate / glycinate / chelate | any | other copper forms only (gluconate, sulfate, citrate, oxide…) = FORM_MISMATCH; form may come from the PDP (R4-1); multi-minerals where another active leads = HERO_SECONDARY |
| H36 | elderberry gummies | n/a | elderberry / Sambucus | — | gummy | syrups, capsules, tablets, lozenges, teas = FORMAT; kids-only = EX_KIDS; immune blends where another active leads (e.g. vitamin C, zinc first) = HERO_SECONDARY |

## Shelf specs (holdout shelves, rulebook v1.7; written from the keyword only, before any listing was pulled; seed 20261104)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H37 | valerian root | n/a | valerian / Valeriana officinalis | — | any | sleep stacks where another active leads (melatonin, magnesium, GABA first) = HERO_SECONDARY; teas and bulk dried root = NOT_SUPPLEMENT; pet calming = EX_PET |
| H38 | boswellia | n/a | boswellia / Boswellia serrata / AKBA / frankincense extract | — | any | joint stacks where another active leads (turmeric, glucosamine first) = HERO_SECONDARY; essential oils, resin for burning/incense, creams = TOPICAL / NOT_SUPPLEMENT |
| H39 | dong quai | n/a | dong quai / Angelica sinensis | — | any | women's/menopause stacks where another active leads = HERO_SECONDARY; teas and bulk dried root = NOT_SUPPLEMENT |
| H40 | pqq | n/a | PQQ / pyrroloquinoline quinone | — | any | CoQ10/NAD stacks where another active leads (CoQ10 first) = HERO_SECONDARY |
| H41 | ginkgo biloba | n/a | ginkgo / Ginkgo biloba | — | any | memory stacks where another active leads = HERO_SECONDARY; teas and bulk dried leaf = NOT_SUPPLEMENT |
| H42 | calcium citrate | mineral | calcium | citrate | any | other calcium forms only (carbonate, coral, hydroxyapatite, algae, lactate…) = FORM_MISMATCH; form may come from the PDP (R4-1); "Calcium Citrate + D3/Magnesium" with calcium citrate leading counts; a label naming a different compound beats a title word |
| H43 | l theanine gummies | n/a | L-theanine / theanine / Suntheanine | — | gummy | capsules, tablets, powders, drinks = FORMAT; kids-only = EX_KIDS; calm/sleep stacks where another active leads (melatonin, magnesium first) = HERO_SECONDARY |

## Shelf specs (holdout shelves, rulebook v1.8; written from the keyword only, before any listing was pulled; seed 20261105)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H44 | cats claw | n/a | cat's claw / Uncaria tomentosa / una de gato | — | any | immune/joint stacks where another active leads = HERO_SECONDARY; teas and bulk dried bark = NOT_SUPPLEMENT |
| H45 | vitex | n/a | vitex / chaste tree / chasteberry / Vitex agnus-castus | — | any | women's hormone stacks where another active leads (DIM, myo-inositol first) = HERO_SECONDARY; teas and bulk dried berry = NOT_SUPPLEMENT |
| H46 | burdock root | n/a | burdock / Arctium lappa | — | any | detox/skin stacks where another active leads = HERO_SECONDARY; teas, food root and bulk dried root = NOT_SUPPLEMENT; topical oils = TOPICAL |
| H47 | chlorella | n/a | chlorella | — | any | greens blends where another active leads (spirulina first) = HERO_SECONDARY; bulk food powders by weight with no servings = NOT_SUPPLEMENT; pet = EX_PET |
| H48 | devils claw | n/a | devil's claw / Harpagophytum procumbens | — | any | joint stacks where another active leads = HERO_SECONDARY; creams/gels = TOPICAL; teas and bulk root = NOT_SUPPLEMENT; pet = EX_PET |
| H49 | zinc gluconate | mineral | zinc | gluconate | any | other zinc forms only (picolinate, citrate, bisglycinate, oxide…) = FORM_MISMATCH; lozenges count as oral; form may come from the PDP (R4-1); "Zinc + Vitamin C" with zinc gluconate leading counts |
| H50 | spirulina tablets | n/a | spirulina | — | pill | powders, flakes, drinks, gummies = FORMAT; greens blends where another active leads = HERO_SECONDARY; pet/fish food = EX_PET / NOT_SUPPLEMENT |

## Shelf specs (holdout shelves, rulebook v1.9; written from the keyword only, before any listing was pulled; seed 20261106)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H51 | artichoke extract | n/a | artichoke / Cynara scolymus | — | any | liver/digestion stacks where another active leads (milk thistle first) = HERO_SECONDARY; food artichoke hearts, teas and bulk leaf = NOT_SUPPLEMENT |
| H52 | bacopa monnieri | n/a | bacopa / brahmi / Bacopa monnieri | — | any | nootropic stacks where another active leads = HERO_SECONDARY; aquarium plants and bulk leaf = NOT_SUPPLEMENT; hair oils = TOPICAL |
| H53 | eleuthero | n/a | eleuthero / Siberian ginseng / Eleutherococcus senticosus | — | any | adaptogen/ginseng stacks where another active leads (Panax first) = HERO_SECONDARY; teas and bulk root = NOT_SUPPLEMENT |
| H54 | schisandra | n/a | schisandra / schizandra / wu wei zi | — | any | adaptogen/liver stacks where another active leads = HERO_SECONDARY; dried berries and teas = NOT_SUPPLEMENT; skincare = TOPICAL |
| H55 | white kidney bean | n/a | white kidney bean / Phaseolus vulgaris / Phase 2 | — | any | carb-blocker stacks where another active leads = HERO_SECONDARY; food beans = NOT_SUPPLEMENT |
| H56 | zinc citrate | mineral | zinc | citrate | any | other zinc forms only (gluconate, picolinate, bisglycinate, oxide…) = FORM_MISMATCH; form may come from the label; multi-mineral titles take the zinc form from the zinc's own wording; lozenges count as oral; toothpaste/mouthwash = TOPICAL |
| H57 | turmeric gummies | n/a | turmeric / curcumin | — | gummy | capsules, tablets, powders, shots, teas = FORMAT; kids-only = EX_KIDS; joint stacks where another active leads (ACV, glucosamine first) = HERO_SECONDARY |

## Shelf specs (holdout shelves, rulebook v2.0; written from the keyword only, before any listing was pulled; seed 20261107)

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H58 | white willow bark | n/a | white willow / Salix alba / salicin | — | any | pain/joint stacks where another active leads = HERO_SECONDARY; bulk bark, teas = NOT_SUPPLEMENT; skincare = TOPICAL |
| H59 | olive leaf extract | n/a | olive leaf / oleuropein / Olea europaea | — | any | immune stacks where another active leads = HERO_SECONDARY; olive oil foods, teas = NOT_SUPPLEMENT; skincare = TOPICAL |
| H60 | pau d'arco | n/a | pau d'arco / taheebo / lapacho / Tabebuia | — | any | cleanse stacks where another active leads = HERO_SECONDARY; bulk bark and teas = NOT_SUPPLEMENT |
| H61 | red yeast rice | n/a | red yeast rice / Monascus purpureus | — | any | cholesterol stacks where another active leads (CoQ10, plant sterols first) = HERO_SECONDARY; food/condiment red rice = NOT_SUPPLEMENT |
| H62 | bilberry | n/a | bilberry / Vaccinium myrtillus | — | any | eye stacks where another active leads (lutein first) = HERO_SECONDARY; jams, dried fruit, teas = NOT_SUPPLEMENT |
| H63 | copper gluconate | mineral | copper | gluconate | any | other copper forms only (bisglycinate, citrate, sulfate, oxide…) = FORM_MISMATCH; form may come from the label; multi-mineral titles take the copper form from the copper's own wording; copper cookware/jewellery = NOT_SUPPLEMENT |
| H64 | probiotic gummies | n/a | probiotic / Lactobacillus / Bifidobacterium / Bacillus | — | gummy | capsules, powders, drinks, chewables = FORMAT; kids-only = EX_KIDS; multi-actives where another active leads (ACV, fiber first) = HERO_SECONDARY; pet = EX_PET |

## Shelf specs (holdout shelves, rulebook v2.1; written from the keyword only, before any listing was pulled; seed 20261108)

Hero names are apostrophe-tolerant (' = optional straight/curly quote plus optional space).

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H65 | gotu kola | n/a | gotu kola / Centella asiatica / Asiatic pennywort / mandukaparni | — | any | brain/vein stacks where another active leads = HERO_SECONDARY; skincare (cica creams, serums) = TOPICAL; bulk herb, teas = NOT_SUPPLEMENT |
| H66 | hibiscus | n/a | hibiscus / roselle / Hibiscus sabdariffa | — | any | heart/BP stacks where another active leads = HERO_SECONDARY; dried flowers, teas, drinks, hair/skin products = NOT_SUPPLEMENT / TOPICAL |
| H67 | cranberry | n/a | cranberry / Vaccinium macrocarpon / PACran | — | any | urinary stacks where another active leads (D-mannose first) = HERO_SECONDARY; juice, dried fruit, sauce = NOT_SUPPLEMENT; pet = EX_PET |
| H68 | mullein | n/a | mullein / Verbascum thapsus | — | any | lung stacks where another active leads = HERO_SECONDARY; ear oil = TOPICAL; dried leaf, teas = NOT_SUPPLEMENT |
| H69 | licorice root | n/a | licorice / liquorice / Glycyrrhiza / DGL / mulethi | — | any | digestive stacks where another active leads = HERO_SECONDARY; candy, teas, bulk root = NOT_SUPPLEMENT; skincare = TOPICAL |
| H70 | chromium polynicotinate | mineral | chromium | polynicotinate / niacin-bound / ChromeMate | any | other chromium forms only (picolinate, chloride, GTF, yeast, glycinate…) = FORM_MISMATCH; form may come from the label; blood-sugar stacks where another active leads = HERO_SECONDARY |
| H71 | vitamin d3 gummies | n/a | vitamin D3 / cholecalciferol / vitamin D | — | gummy | capsules, softgels, drops, tablets = FORMAT; kids-only = EX_KIDS; multivitamin gummies where D3 is one of many = HERO_SECONDARY; D3+K2 where D3 leads counts |

## Shelf specs (holdout shelves, rulebook v2.2; written from the keyword only, before any listing was pulled; seed 20261109)

Hero names are apostrophe-tolerant. Per v2.2 spec hygiene, no trademark names or descriptors appear as hero, form or other forms; trademarks map through the v2.2 trademark table.

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H72 | chamomile | n/a | chamomile / Matricaria chamomilla | — | any | sleep/calm stacks where another active leads = HERO_SECONDARY; teas, dried flowers = NOT_SUPPLEMENT; creams, lotions, skincare = TOPICAL |
| H73 | astragalus | n/a | astragalus / Astragalus membranaceus / huang qi | — | any | immune stacks where another active leads = HERO_SECONDARY; cut root, slices, teas, bulk powder = NOT_SUPPLEMENT; pet = EX_PET |
| H74 | tribulus | n/a | tribulus / Tribulus terrestris / puncture vine / gokshura | — | any | men's/test stacks where another active leads = HERO_SECONDARY; bulk powder = NOT_SUPPLEMENT |
| H75 | catuaba | n/a | catuaba / Trichilia catigua / Erythroxylum catuaba | — | any | libido stacks where another active leads = HERO_SECONDARY; bark, teas, bulk = NOT_SUPPLEMENT |
| H76 | gymnema | n/a | gymnema / Gymnema sylvestre / gurmar | — | any | blood-sugar stacks where another active leads (berberine, chromium first) = HERO_SECONDARY; teas, bulk leaf = NOT_SUPPLEMENT |
| H77 | magnesium citrate | mineral | magnesium | citrate | any | other magnesium forms only (oxide, glycinate, malate, threonate…) = FORM_MISMATCH; several forms = FORM_BLEND; form may come from the label; saline laxative liquids/oral solutions count only if sold as a supplement |
| H78 | melatonin tablets | n/a | melatonin | — | pill (tablets, capsules, softgels) | gummies, liquids, sprays, drops = FORMAT; kids-only = EX_KIDS; sleep stacks where another active leads = HERO_SECONDARY |

## Shelf specs (holdout shelves, rulebook v2.3; written from the keyword only, before any listing was pulled; seed 20261110)

Hero names are apostrophe-tolerant. Per v2.2 spec hygiene, no trademark names or descriptors appear as hero, form or other forms; trademarks map through the v2.2 trademark table.

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H79 | elderberry | n/a | elderberry / Sambucus nigra | — | any | immune stacks where zinc/vitamin C or another active leads = HERO_SECONDARY; syrups count only if sold as a supplement; juice, jam, tea, dried berries = NOT_SUPPLEMENT; kids-only = EX_KIDS |
| H80 | shilajit | n/a | shilajit / mumijo | — | any | men's stacks where another active leads = HERO_SECONDARY; resin, drops, gummies, capsules all count; skincare = TOPICAL |
| H81 | beet root | n/a | beet root / beetroot / Beta vulgaris | — | any | nitric-oxide stacks where another active leads = HERO_SECONDARY; plain beet juice, food powders with no serving, canned beets = NOT_SUPPLEMENT |
| H82 | moringa | n/a | moringa / Moringa oleifera | — | any | greens blends where another active leads = HERO_SECONDARY; tea, leaf bulk, seeds for planting, oil for skin = NOT_SUPPLEMENT/TOPICAL |
| H83 | kudzu | n/a | kudzu / Pueraria lobata / puerarin | — | any | stacks where another active leads = HERO_SECONDARY; kudzu starch for cooking = NOT_SUPPLEMENT; Pueraria mirifica is a different plant |
| H84 | ginger root | n/a | ginger / Zingiber officinale | — | any | stacks where turmeric or another active leads = HERO_SECONDARY; candy, chews sold as food, tea, fresh/ground spice = NOT_SUPPLEMENT; black ginger (Kaempferia) is a different plant |
| H85 | triphala | n/a | triphala | — | any | Ayurvedic blends where another named active leads = HERO_SECONDARY; triphala itself is a three-fruit formula and counts as the hero |
| H86 | banaba | n/a | banaba / Lagerstroemia speciosa / corosolic acid | — | any | blood-sugar stacks where berberine, chromium or another active leads = HERO_SECONDARY; tea = NOT_SUPPLEMENT |
| H87 | yarrow | n/a | yarrow / Achillea millefolium | — | any | stacks where another active leads = HERO_SECONDARY; dried herb, tea, seeds for planting = NOT_SUPPLEMENT; skincare = TOPICAL |
| H88 | horny goat weed | n/a | horny goat weed / Epimedium / icariin | — | any | libido/test stacks where maca, tongkat or another active leads = HERO_SECONDARY |
| H89 | potassium gluconate | mineral | potassium | gluconate | any | other potassium forms only (citrate, chloride, bicarbonate, iodide ...) = FORM_MISMATCH; several forms = FORM_BLEND; electrolyte drink mixes where potassium is one of several minerals = HERO_SECONDARY |
| H90 | zinc carnosine | mineral | zinc | carnosine (zinc L-carnosine, polaprezinc; PepZin GI via the trademark table) | any | other zinc forms only = FORM_MISMATCH; gut formulas where another active leads = HERO_SECONDARY |
| H91 | vitamin c gummies | vitamin | vitamin C / ascorbic acid / ascorbate | — | gummy | capsules, tablets, powders, drinks = FORMAT; kids-only = EX_KIDS; multivitamin gummies = HERO_SECONDARY; elderberry/zinc immune gummies where another active leads = HERO_SECONDARY |
| H92 | berberine capsules | n/a | berberine | — | pill (capsules, tablets, softgels) | gummies, powders, drops = FORMAT; blood-sugar stacks where another active leads = HERO_SECONDARY |


## Shelf specs (holdout shelves, rulebook v2.4; written from the keyword only, before any listing was pulled; seed 20261111)

Hero names are apostrophe-tolerant. Per v2.2 spec hygiene, no trademark names or descriptors appear as hero, form or other forms; trademarks map through the v2.2 trademark table.

| # | Shelf | Class | Hero | Form / delivery | Format | Notes |
|---|---|---|---|---|---|---|
| H93 | nopal | n/a | nopal / Opuntia / prickly pear cactus | — | any | blood-sugar stacks where another active leads = HERO_SECONDARY; fresh or canned nopales, juice, candy, seed oil for skin = NOT_SUPPLEMENT/TOPICAL |
| H94 | goji berry | n/a | goji / wolfberry / Lycium barbarum | — | any | superfruit blends where another active leads = HERO_SECONDARY; dried berries, snacks, juice, tea = NOT_SUPPLEMENT |
| H95 | jujube | n/a | jujube / Ziziphus / suan zao ren | — | any | sleep stacks where another active leads = HERO_SECONDARY; dried fruit, snacks, tea, seeds or trees for planting = NOT_SUPPLEMENT |
| H96 | black walnut | n/a | black walnut / Juglans nigra | — | any | cleanse/parasite blends where wormwood, clove or another active leads = HERO_SECONDARY; nuts for eating, hair dye, wood stain = NOT_SUPPLEMENT; skincare = TOPICAL |
| H97 | yohimbe | n/a | yohimbe / yohimbine / Pausinystalia | — | any | libido/fat-loss stacks where another active leads = HERO_SECONDARY; bark for tea = NOT_SUPPLEMENT |
| H98 | punarnava | n/a | punarnava / Boerhavia diffusa | — | any | Ayurvedic blends where another named active leads = HERO_SECONDARY (classical named formulas: R13-2); bulk powder with no supplement serving = NOT_SUPPLEMENT |
| H99 | safed musli | n/a | safed musli / Chlorophytum borivilianum | — | any | vitality stacks where ashwagandha or another active leads = HERO_SECONDARY; bulk powder with no supplement serving = NOT_SUPPLEMENT |
| H100 | silica | mineral | silica / silicon / orthosilicic acid | — | any | hair-skin-nail stacks where biotin, collagen or another active leads = HERO_SECONDARY; horsetail-sourced silica counts when silica is the named hero; desiccant packets, silica gel, cat litter = NOT_SUPPLEMENT |
| H101 | acai | n/a | acai / Euterpe oleracea | — | any | superfruit/weight-loss blends where another active leads = HERO_SECONDARY; frozen packs, bowls, juice, sorbet, food powders with no serving = NOT_SUPPLEMENT; skincare = TOPICAL |
| H102 | echinacea | n/a | echinacea | — | any | immune stacks where elderberry, zinc, vitamin C or another active leads = HERO_SECONDARY; tea, seeds for planting = NOT_SUPPLEMENT; kids-only = EX_KIDS |
| H103 | iron fumarate | mineral | iron | fumarate (ferrous fumarate) | any | other iron forms only (bisglycinate, sulfate, gluconate, carbonyl ...) = FORM_MISMATCH; several forms = FORM_BLEND; prenatal/multivitamins where iron is one of many = HERO_SECONDARY |
| H104 | selenium selenomethionine | mineral | selenium | selenomethionine (L-selenomethionine) | any | other selenium forms only (selenite, selenate, selenium yeast, methylselenocysteine) = FORM_MISMATCH; several forms = FORM_BLEND; antioxidant stacks where another active leads = HERO_SECONDARY |
| H105 | ashwagandha capsules | n/a | ashwagandha / Withania somnifera | — | pill (capsules, tablets, softgels) | gummies, powders, drinks, drops = FORMAT; stress/sleep stacks where another active leads = HERO_SECONDARY |
| H106 | apple cider vinegar gummies | n/a | apple cider vinegar / ACV | — | gummy | capsules, liquid vinegar, drinks = FORMAT (liquid vinegar for cooking = NOT_SUPPLEMENT); stacks where another active leads = HERO_SECONDARY; kids-only = EX_KIDS |

## Changelog
- rulebook_v1 2026-10-28: first written version. Encodes v8.1 gate behaviour plus Gautam's rule-1 steering
  (hero-led complex IN, hero secondary OUT; named form/format strict; no pet/infant/food; variants once;
  own shelf or NO_SHELF). Adds G8 (PDP evidence beats regex) for the PDP-enriched gate.

### rulebook_v1.1 clarification (2026-10-28 18:55 IST, during gold labelling — labelling standard only, gate untouched)
G2 lead-form test, made explicit: a listing whose TITLE sells it as the named form (e.g. "Magnesium Glycinate Gummies")
and whose other forms appear only in bullets/ingredients as smaller parts → glycinate is the lead form → passes G2
(labelled HERO_LED_COMPLEX). EX_FORM_BLEND when the title itself says Complex / N-in-1 / N forms, or names a second
form in the title ("Glycinate, Malate, Citrate", "with Magnesium L-Threonate"). Pending Gautam's call in GOLD_SAMPLE.

## v1.1 (Gautam, 28 Oct 2026)
- Hero-first bundles count.
- Reseller copies of one product count once.
- Kids/toddler products excluded (EX_KIDS).
- Mag glycinate gummies: in if title leads with glycinate; out if "complex" or another form leads.

## v1.2 (Gautam Round 2, 29 Oct 2026 ~11:41 IST)
- Q1 all-ages products count; only kids-only are EX_KIDS. Q2 different-brand clones count separately. Q3 multi-form lists that lead
  with glycinate are IN. Q5 same brand + same formula under another name/size = one product. Q6 Natrol Sleep & Restore Mag Glycinate
  Blend Gummies IN. Q7 Florastor Gas & Bloat OUT and new general rule G9 G-NAME. Q4 CircuLegs OUT under G9 (override-pending).
  Q8 title and bullets beat PDP Item Form.
- Addendum-5 gate fixes written into the globals: unlisted ingredient before the hero → HERO_SECONDARY; culinary gum powder is not a
  supplement; identical titles and N-bottle listings count once; hyphenated names match; brand words (Spice, Recipes) ignored.
- Added holdout shelf rows H1–H8.

## v1.3 (Gautam Round 3, 29 Oct 2026 ~13:02 IST)
- Added R3-1..R3-5, the G2 update, the delivery-shelf rule, no-PDP-rescue, exclusion-in-context, and holdout specs H9–H15 (seed 20261031). Gold v4 (`gold_set_v4.json`) is labelled under v1.3.

## v1.4 (Gautam Round 4, 29 Oct 2026 ~15:24 IST)
- Added R4-1..R4-3, hero-first bundles, Humans & Pets, glyph normalisation and sold-unit format. Gold v5 (`gold_set_v5.json`, gold_work/build_v5.py) is labelled under v1.4: 6 changes (R4-2 5, R4-1 1), distinct products 740 -> 745. v1.3 backup: gold_work/SHELF_RULEBOOK_v1.3_backup.md.
## v1.5 (Gautam Round 5, 29 Oct 2026 ~18:15 IST)
- R5-1..R5-4 + mineral form-blend + settled items (see "v1.5 overrides"). Encoded in gate_v93.py (rules M1–M8). v1.4 backup: gold_work/SHELF_RULEBOOK_v1.4_backup.md.
## v1.6 (Gautam Round 6, 30 Oct 2026 ~15:07 IST)
- R6-1..R6-3 + whole-food/bulk settle + carrier oils + settled items (see "v1.6 overrides"). Encoded in gate_v94.py (rules W1–W9, C1–C3). v1.5 backup: gold_work/SHELF_RULEBOOK_v1.5_backup.md.
## v1.7 (NPD settles, 30 Oct 2026 ~16:07 IST)
- Seven failure classes from the v9.4 holdout settled from existing rules (see "v1.7 overrides"), incl. the copper form-shelf label rule (settled by NPD from R3/R4, not a Gautam ruling). Encoded in gate_v95.py (rules X1–X7). Holdout specs H37–H43 (seed 20261104). Gold v7 unchanged (no gold row conflicts). v1.6 backup: gold_work/SHELF_RULEBOOK_v1.6_backup.md.
## v1.8 (Gautam Round 7 + NPD settles, 31 Oct 2026 ~10:01 IST)
- R7-1 (label lead by dose) + misspelled hero, branded ingredient, descriptors, "X Free", whole root with dose (see "v1.8 overrides"). Encoded in gate_v96.py (rules Y1–Y6). Holdout specs H44–H50 (seed 20261105). Gold v7 unchanged (no gold row changed by the rulings; gold v8 not built). v1.7 backup: gold_work/SHELF_RULEBOOK_v1.7_backup.md.
## v1.9 (Gautam Round 8 + NPD settles, 1 Nov 2026 ~10:27 IST)
- R8-1 (coined name containing the hero word; refines R3-3) + R7-1 helper skip + herb-name pet guard, animal products, homeopathic, no-supplement-signal, bulk herb-part powder, root descriptors with a dose, multi-mineral form, pack-count merge (see "v1.9 overrides"). Encoded in gate_v97.py (rules Z1–Z10). Holdout specs H51–H57 (seed 20261106). Gold v7 unchanged (no gold row changed by the rulings; gold v8 not built). v1.8 backup: gold_work/SHELF_RULEBOOK_v1.8_backup.md.

## v2.0
- 1 Nov 2026 IST: added "v2.0 overrides" (Gautam R9-1; NPD settles for Maximum Slim, OLLY Sleep, whole foods, category vs directions, form blends in one clause, another mineral leads, formula names before "with", hero synonym words) and holdout shelf specs H58-H64 (seed 20261107, addendum 13). No earlier rule removed.

## v2.1
- 1 Nov 2026 IST: added "v2.1 overrides" (Gautam R10-1; NPD settles for Planetary Herbals, Life Extension Zinc Caps, Organic Immune Support; general fixes for vitamins in the label lead, co-named earlier actives, fiber/Multi, dictionary-safe misspellings, salt carriers, apostrophes) and holdout shelf specs H65-H71 (seed 20261108, addendum 14). Encoded in gate_v99.py (rules B0-B8). No earlier rule removed. v2.0 backup: gold_work/SHELF_RULEBOOK_v2.0_backup.md.

## v2.2
- 1 Nov 2026 IST: added "v2.2 overrides" (Gautam R11-1 trademark ingredient names + trademark table; NPD settles: GTF is a descriptor of chromium polynicotinate, NuEthix SLIN-Trol = HERO_SECONDARY under R5-3, personal-care words = TOPICAL, bulk cut/pound powders = NOT_SUPPLEMENT, spec hygiene + lint) and holdout shelf specs H72-H78 (seed 20261109, addendum 15). Encoded in gate_v100.py (C1-C5). The H70 row above (v2.1) still shows ChromeMate/GTF as written then; v2.2 overrides it. No earlier rule removed. v2.1 backup: gold_work/SHELF_RULEBOOK_v2.1_backup.md.

## v2.3
- 1 Nov 2026 IST: added "v2.3 overrides" (Gautam: hybrid rules + model judge with three-way calls; R12-1 MagicMag counts; general fixes for v10.0 misses under existing rules: R7-1 by dose, saline laxatives, co-named earlier actives, origin/varietal adjectives, category vs directions, N-in-1 counts, serving in copy, precursor pairs) and holdout shelf specs H79-H92 (seed 20261110, addendum 16). Encoded in gate_v110.py (D1-D8, U1-U4) + judge_prompt_v110.txt. No earlier rule removed. v2.2 backup: gold_work/SHELF_RULEBOOK_v2.2_backup.md.
## v2.4
- 3 Nov 2026 IST: added "v2.4 overrides" (Gautam R12-1 restated, R13-1..R13-6, v11.1 non-supplement/topical list; NPD misspelling clarification) and holdout shelf specs H93–H106 (seed 20261111). v2.3 backup: gold_work/SHELF_RULEBOOK_v2.3_backup.md.
