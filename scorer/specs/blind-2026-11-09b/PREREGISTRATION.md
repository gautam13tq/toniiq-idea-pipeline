# Blind round 2 pre-registration, 9 Nov 2026 (5 fresh Atlas shelves, seed 20261111)

Written before any run, Datarova pull or listing view for these shelves. Specs were written from the keyword only, following the spec-writing rules in scorer/README.md (2f1a9b8). NOT RUN YET: the tracker decides when.

## Draw
- Source: Supabase category_atlas_entries (527 rows, 390 distinct entry_key). Where a key has several rows, the lowest id is used.
- Pool (356 keys): the 390 keys minus the 5 Atlas keys from round 1 (inulin-prebiotic-fiber-powder, rice-germ-spermidine-system, creatine-for-women-flavored, nad-booster-powder, urolithin-a) and minus any key whose key, name or best keyword names a hero already tested (astaxanthin, boulardii, black garlic, magnesium glycinate, theanine, inulin, spermidine, creatine for women, NAD, urolithin, PEA, lactoferrin). The hero filter was added because a plain draw picked liposomal-urolithin-a again.
- `random.Random(20261111).sample(sorted(pool), 5)`: maca-powder, high-cfu-multi-strain-probiotics, liposomal-boswellia, coq10-ubiquinol-phytosome, magnesium-l-threonate.

## Shelf keywords chosen from the entry (keyword only)
- maca-powder -> "maca powder" (gate_format powder).
- high-cfu-multi-strain-probiotics -> "50 billion probiotic" (Atlas best keyword is "probiotic", too broad for one shelf; 50 billion is the dose co-term, microbial true).
- liposomal-boswellia -> "liposomal boswellia" (required liposom).
- coq10-ubiquinol-phytosome -> "coq10 phytosome" (required phytosom). Atlas shows 26 clicks for this keyword, so it may fail the demand gate; kept as drawn.
- magnesium-l-threonate -> "magnesium l threonate" (form threonate, other magnesium forms out).

## Pass marks (same as round 1, section 7C)
- Every run: 0 failed BLOCKER checks; cost under $2.
- Precision, P2 to P4, false drops and E7 need Gautam's labels.

## Spec SHA-256
- d82ec6e1df6d86eb2034776fd8ccc67ecd50e943eeaa0108d1ec2454f1bd0b7d  coq10-phytosome.json
- 0d28cc652535df3b43183863887fac14558bfd1d1ed714db4a6678f1051aa37e  liposomal-boswellia.json
- c0f7b61a6b2eab6bfa023d5e4a32322630c6901da570d80786cf19a35aad6094  maca-powder.json
- 82a2a4178bdab6816f5e2873dd4f2a96cb6c6a41158a40e1ba132cccd5ab3f7a  magnesium-l-threonate.json
- 018b3bbae28129ed2d60bab5eeb285e5f5e21892aea8edd06030bca206266b23  probiotic-50-billion.json
