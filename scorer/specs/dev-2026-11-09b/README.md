# Dev specs 9 Nov 2026 (b), run on ecce617

Fixes for two blind-3 shelves. These are dev shelves, not blind.

- magnesium-complex-for-men.json: required_regex now also rejects "women men" / "men women" with no connector or with a comma.
- kids-magnesium.json: the shelf keyword is "kids magnesium", the Atlas best keyword (6,386 clicks), instead of the primary keyword "kids magnesium powder" (27 clicks). The format co-term is dropped because the keyword has no format word.

- ea0db62b433cee364d08f7427ba79e4b50e67f0d52fcb03f1a7eff7e6c2f0593  kids-magnesium.json
- 24dd7281a5f4283652c9c03b38074d9861e9f55514ab65bbfd2d7494df3852f9  magnesium-complex-for-men.json

v3 (after the ecce617 run, not yet run): the men's spec used `\b` before "women"/"men", and Python treats CJK characters as word characters, so a title ending "Function丨Women Men." slipped through (Vita PLynxera, #2 on the ecce617 shelf). The boundary is now `(?<![a-z])`.
- 1bf7c5769170c014f22047cfd6f57e2a23e4909708b8e96c700d2c51b385fa5b  magnesium-complex-for-men.json (v3)
