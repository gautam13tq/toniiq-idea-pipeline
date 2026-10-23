#!/usr/bin/env python3
"""Print a minimal schema for testing score_idea on plain Postgres.

The baseline migrations need Supabase extras (pg_cron, pg_net, vault), so this
pulls only the tables, constraints and triggers score_idea touches out of them.
"""
import pathlib
import re

M = pathlib.Path(__file__).resolve().parent.parent / 'migrations'
TABLES = ['idea_candidates', 'product_concepts', 'pending_actions', 'concept_scores',
          'concept_competitive_research', 'datarova_enrichments', 'system_config']
TRIGGER_FUNCTIONS = ['enqueue_concept_action', 'rollup_idea_stage_from_concepts',
                     'update_candidate_timestamp', 'update_product_concepts_timestamp']


def read(name):
    return (M / name).read_text()


out = ["DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
       "DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
       "DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"]
out += [l for l in read('20260819132712_npd_01_enums.sql').splitlines() if l.startswith('CREATE TYPE')]
tables = read('20260819132905_npd_02_tables.sql')
for t in TABLES:
    out.append(re.search(r'CREATE TABLE public\.' + t + r' \(.*?\n\);', tables, re.S).group(0))
for f in ['20260819133115_npd_04_constraints.sql', '20260819133155_npd_05_fks.sql']:
    for line in read(f).splitlines():
        m = re.match(r'ALTER TABLE public\.(\w+) ', line)
        if not m or m.group(1) not in TABLES:
            continue
        ref = re.search(r'REFERENCES (\w+)', line)
        if ref and ref.group(1) not in TABLES:
            continue
        out.append(line)
functions = read('20260819133011_npd_03_functions.sql')
for name in TRIGGER_FUNCTIONS:
    start = functions.find('CREATE OR REPLACE FUNCTION public.' + name)
    body = functions.find('$function$', start)
    end = functions.find('$function$;', body + len('$function$'))
    out.append(functions[start:end + len('$function$;')])
for line in read('20260819133256_npd_07_triggers.sql').splitlines():
    m = re.search(r'ON public\.(\w+)', line)
    if line.startswith('CREATE TRIGGER') and 'sync_greenlit' not in line and m.group(1) in TABLES:
        out.append(line)
piece0 = read('20261022064956_piece0_lockdown_and_score_scale.sql')
out.append(re.search(r'ALTER TABLE public\.concept_scores\s+ADD COLUMN score_scale.*?STORED;', piece0, re.S).group(0))
print('\n'.join(out))
