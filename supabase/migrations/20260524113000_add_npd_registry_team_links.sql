alter table public.npd_registry_products
  add column if not exists notion_url text,
  add column if not exists gdrive_folder_url text;

update public.npd_registry_products
set
  notion_url = data.notion_url,
  gdrive_folder_url = data.gdrive_folder_url
from (
  values
    ('Creatine HMB for Men', 'https://www.notion.so/28884b4aa7cd80de8c21d12ccb5ac98e', 'https://drive.google.com/drive/folders/1pEROyssZLC_juYG3W4x6Q1xlXrFXjTUB'),
    ('Toniiq Muscle Peptides', 'https://www.notion.so/33d84b4aa7cd81b6a33eeeceee5cfa68', 'https://drive.google.com/drive/folders/1fexnjjN-moQFVXnEBWOGOpaDwQBvVLET'),
    ('Iodine Nasal Spray', 'https://www.notion.so/35f84b4aa7cd8111bc0efc37ba90c9b9', 'https://drive.google.com/drive/folders/1L-HHPEHGbCKbTOA69tu1_JGh7GbKSt5w'),
    ('Neuropathy Support Complex', 'https://www.notion.so/34584b4aa7cd8163900ed6ec59095988', 'https://drive.google.com/drive/folders/1YYU0SjYG2c_-AUjIbJiGYSYUB2-YnqQ1'),
    ('Nattokinase 5-in-1', 'https://www.notion.so/33384b4aa7cd81cc967ac77749f152cc', 'https://drive.google.com/drive/folders/1I1bRcVF2ko2vcGvaDeb3vf8wxIKgbT7N'),
    ('Aged Garlic Extract', 'https://www.notion.so/33584b4aa7cd8178a1acd1ed9e1f271b', 'https://drive.google.com/drive/folders/1lYf3IMB5bw3I1gkrsfVyEPh2XY07P-na'),
    ('Premium Quercetin (Quercefit® 5-in-1)', 'https://www.notion.so/35584b4aa7cd810cbc5cf8daa94ce972', 'https://drive.google.com/drive/folders/1qUx2ZNK47uhJK0tzjOhmKn-cVpm_NLz1'),
    ('Liposomal Iron', 'https://www.notion.so/2b184b4aa7cd803d87dcd62ec3544a36', 'https://drive.google.com/drive/folders/1WFpEWqfFP10tDGKOWT5d0-AOZog0sa4h'),
    ('Citrus Bergamot', 'https://www.notion.so/24984b4aa7cd805db8f4ee9e83c4bf31', 'https://drive.google.com/drive/folders/12_p-YYDWZuwwY00l5lHSGDYW4cWz4adZ'),
    ('Lactoferrin', 'https://www.notion.so/1ac84b4aa7cd809e943cd60d7904ce7b', 'https://drive.google.com/drive/folders/1G1ZDPOMKBPi567s0ynj6iMd0rJGlDVBE'),
    ('Colostrum Capsules', 'https://www.notion.so/2be84b4aa7cd802baf60e08aa02fd189', 'https://drive.google.com/drive/folders/140nJEKQtatALlYiKtieaYJGQmU-uAjoE'),
    ('Liposomal Senolytic Complex', 'https://www.notion.so/35584b4aa7cd81bebffecdb679e25caa', 'https://drive.google.com/drive/folders/1TyzgbdUR4RRar-zFPTTDmBarw31zQDJ4'),
    ('PHGG / Sunfiber', null, 'https://drive.google.com/drive/folders/19g31SKkmLK9tDpcCFijV4933WVcSIS7i'),
    ('GLP1 Fiber', 'https://www.notion.so/33484b4aa7cd8138a1a9e522760102ff', null),
    ('Protein Coffee', 'https://www.notion.so/23484b4aa7cd80bb8eaae50a0e8109a1', 'https://drive.google.com/drive/folders/1A04ZaFiZ1RrHE8RhLSNWFy5hqUJ9RFgw'),
    ('Beet Root Capsules', 'https://www.notion.so/31b84b4aa7cd8141bc53f6afa05db3d3', 'https://drive.google.com/drive/folders/1-Mz7PNHZ1etL9oc4S4ecCFhxzn27YDG8'),
    ('Lions Mane Triple Extract', 'https://www.notion.so/31f84b4aa7cd8007a68fe23e339f3137', 'https://drive.google.com/drive/folders/1b0kJmfFT37TLEiewfom13OeT3YP3kjqo'),
    ('Mushroom Coffee Reformulation', 'https://www.notion.so/20a84b4aa7cd80ea90f9de162f711eea', 'https://drive.google.com/drive/folders/119c76hI5NxR0YY_dYgZjzsp8TecRPUed'),
    ('NMN Collagen HA', 'https://www.notion.so/31b84b4aa7cd817596c0e1e8f2598542', null),
    ('Magnesium Sleep Powder', 'https://www.notion.so/31b84b4aa7cd810991dcce77eafe9e9d', null),
    ('NAC Ethyl Ester', 'https://www.notion.so/ecec2f3a59254fb688f3c2d198360086', null),
    ('Methylene Blue + NMN', 'https://www.notion.so/1c484b4aa7cd80a4a305e43982bf6965', null)
) as data(product, notion_url, gdrive_folder_url)
where public.npd_registry_products.product = data.product;
