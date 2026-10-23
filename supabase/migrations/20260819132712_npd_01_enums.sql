-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
CREATE TYPE public.artifact_type AS ENUM ('costing_model', 'formulation_strategy', 'competitive_analysis', 'product_brief', 'spec_sheet', 'coa', 'supplier_quote', 'other');
CREATE TYPE public.dev_priority AS ENUM ('high', 'medium', 'low');
CREATE TYPE public.dev_stage AS ENUM ('sourcing', 'formulation', 'r_and_d', 'pre_greenlight');
CREATE TYPE public.diff_fit AS ENUM ('low', 'moderate', 'high');
CREATE TYPE public.idea_stage AS ENUM ('inbox', 'research', 'evaluation', 'development', 'archive');
CREATE TYPE public.quotation_source AS ENUM ('current_pricing', 'new_quotation');
CREATE TYPE public.signal_strength AS ENUM ('weak', 'moderate', 'strong');
CREATE TYPE public.supplier_tier AS ENUM ('core', 'preferred', 'new');
CREATE TYPE public.supplier_type AS ENUM ('rm_supplier', 'manufacturer');
CREATE TYPE public.trend_direction AS ENUM ('declining', 'stable', 'rising', 'breakout', 'no_data');
