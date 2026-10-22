update public.npd_registry_products
set
  product = 'Benfotiamine Complex',
  local_folder_path = 'Product Development/Benfotiamine Complex/',
  registry_anchor = '#benfotiamine-complex'
where product = 'Neuropathy Support Complex'
  and not exists (
    select 1
    from public.npd_registry_products existing
    where existing.product = 'Benfotiamine Complex'
  );

delete from public.npd_registry_products
where product = 'Neuropathy Support Complex'
  and exists (
    select 1
    from public.npd_registry_products existing
    where existing.product = 'Benfotiamine Complex'
  );

with refresh as (
  select *
  from (
    values
      (
        'Iodine Nasal Spray',
        'Active Development',
        'R&D',
        'high',
        85::numeric,
        null::text,
        'Attack Now',
        'Med',
        '2026-05-13'::date,
        'Chase Mimi (COA + black bottle quote + KI %); Jason sample eval',
        'Is the bench sample acceptable and does the COA confirm Nasomin-equivalent KI %?',
        'Sterility/preservative + new format + nasal-spray packaging',
        null::text,
        'Product Development/Iodine Nasal Spray/',
        null::uuid,
        '#iodine-nasal-spray',
        2
      ),
      (
        'Benfotiamine Complex',
        'Active Development',
        'R&D',
        'medium',
        84::numeric,
        null::text,
        'Attack Now',
        'High',
        '2026-05-13'::date,
        'Await samples from Phytochem (benfotiamine+ALCAR) and Effepharm (PEA). Upload costing+strategy to GDrive (manual).',
        'None - R&D handoff complete, samples in flight',
        'GDrive binary upload pending (manual)',
        null::text,
        'Product Development/Benfotiamine Complex/',
        'ea4264bb-d660-4c53-b55a-d0a203e3f00e'::uuid,
        '#benfotiamine-complex',
        3
      ),
      (
        'Nattokinase 5-in-1',
        'Active Development',
        'R&D',
        'medium',
        69::numeric,
        null::text,
        'Selective Hold',
        'Med',
        '2026-05-17'::date,
        'Confirm Peptizyme sample status; resolve DRcaps/copacking/doc drift; reply to JBSL (NSK-SD Nattokinase) follow-up',
        'Does NSK-SD (JBSL) replace/supplement GeneFerm supply for the 10,000 FU anchor?',
        'Sample in transit; DRcaps/copacking question; enzyme supplier validation',
        null::text,
        'Product Development/Nattokinase Serrapeptase 5in1/',
        'b8dd1a61-525c-483d-8357-d606ae864d37'::uuid,
        '#nattokinase-5-in-1-circulatory-complex',
        4
      ),
      (
        'Creatine Chews',
        'Active Development',
        'Evaluation complete (Phase B done)',
        'high',
        68::numeric,
        'Phase B complete; Econ/Exec pending',
        'Selective Hold',
        'Med',
        '2026-05-17'::date,
        'Await CDMO replies (Catalent/Sirio/Vitaquest). Review HTC Health Gummies brochure + MOQ note as alternate CMO lead. Then run decide_greenlight pending_action d9c22de8 after economics confirm.',
        'Greenlight decision after CDMO economics are known (MOQ + unit cost + feasibility).',
        'CDMO unit economics unknown; form-factor feasibility at 5g/chew still needs CDMO confirmation.',
        null::text,
        'Product Development/Creatine Chews/',
        'e80df747-4843-45d7-ae76-e01cffd9d64e'::uuid,
        '#creatine-chews',
        8
      ),
      (
        'Creatine HMB for Men',
        'Active Development',
        'Concept / initial formulation',
        'high',
        73::numeric,
        'samples requested',
        'Needs One Unlock',
        'Med',
        '2026-05-15'::date,
        'Await NNB tracking + sample; await ECA PureHMB(TM)+iCreatine(TM) tracking, iCreatine(TM) quote/spec, and GAA response; await EffePharm HMB/GAA response; then bench-test and draft costing',
        'Does ECA''s application-performance advantage justify the higher PureHMB(TM) cost?',
        '2026-05-15 morning check: no new ECA/EffePharm reply; NNB tracking still pending beyond the 2026-05-14 ships early next week confirmation. Canonical concept is Creatine HMB first, for men second.',
        null::text,
        'Product Development/Creatine HMB for Men/',
        'e01b942e-9f15-4154-85eb-0deb15e183d7'::uuid,
        '#creatine-hmb-for-men',
        9
      ),
      (
        'Beet Root Capsules',
        'Shelved / Parked',
        'On Hold',
        'parked',
        59::numeric,
        null::text,
        'Park / Reframe',
        'Med',
        '2026-05-12'::date,
        'Initial 200mg nitrate costing built; no active work unless generic red spinach spec or counsel review creates a sharper wedge',
        'Can a 200mg standardized nitrate capsule win at premium pricing without blood-pressure disease claims?',
        'Herbochem 20% red spinach spec unconfirmed; Oxystorm/RedNite quote artifacts need re-check; patent/claim risk',
        'Generic red spinach spec, counsel review, or a sharper nitrate-capsule wedge changes conviction',
        'Product Development/Beet Root Capsules/',
        '791ea46c-6087-446c-9762-93f7636506f6'::uuid,
        '#beet-root-capsules',
        4
      )
  ) as row (
    product,
    queue,
    state,
    priority,
    lv_score,
    lv_score_note,
    lv_band,
    confidence,
    last_updated,
    today_action,
    decision_needed,
    blocker_risk,
    reactivation_trigger,
    local_folder_path,
    concept_id,
    registry_anchor,
    sort_order
  )
)
insert into public.npd_registry_products (
  product,
  queue,
  state,
  priority,
  lv_score,
  lv_score_note,
  lv_band,
  confidence,
  last_updated,
  today_action,
  decision_needed,
  blocker_risk,
  reactivation_trigger,
  local_folder_path,
  concept_id,
  registry_anchor,
  detail_markdown,
  sort_order
)
select
  product,
  queue,
  state,
  priority,
  lv_score,
  lv_score_note,
  lv_band,
  confidence,
  last_updated,
  today_action,
  decision_needed,
  blocker_risk,
  reactivation_trigger,
  local_folder_path,
  concept_id,
  registry_anchor,
  concat(
    '### ', product,
    E'\n- Queue: ', queue,
    E'\n- State: ', state,
    E'\n- Priority: ', priority,
    E'\n- LV: ', coalesce(lv_score::text, 'n/a'), case when lv_score_note is null then '' else concat(' [', lv_score_note, ']') end,
    E'\n- LV Band: ', coalesce(lv_band, 'n/a'),
    E'\n- Confidence: ', coalesce(confidence, 'n/a'),
    E'\n- Today Action: ', coalesce(today_action, 'n/a'),
    E'\n- Decision Needed: ', coalesce(decision_needed, 'n/a'),
    E'\n- Blocker / Risk: ', coalesce(blocker_risk, 'n/a'),
    E'\n- Reactivation Trigger: ', coalesce(reactivation_trigger, 'n/a')
  ),
  sort_order
from refresh
on conflict (product) do update set
  queue = excluded.queue,
  state = excluded.state,
  priority = excluded.priority,
  lv_score = excluded.lv_score,
  lv_score_note = excluded.lv_score_note,
  lv_band = excluded.lv_band,
  confidence = excluded.confidence,
  last_updated = excluded.last_updated,
  today_action = excluded.today_action,
  decision_needed = excluded.decision_needed,
  blocker_risk = excluded.blocker_risk,
  reactivation_trigger = excluded.reactivation_trigger,
  local_folder_path = excluded.local_folder_path,
  concept_id = excluded.concept_id,
  registry_anchor = excluded.registry_anchor,
  detail_markdown = excluded.detail_markdown,
  sort_order = excluded.sort_order;
