-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
CREATE TRIGGER touch_category_atlas_categories_updated_at BEFORE UPDATE ON public.category_atlas_categories FOR EACH ROW EXECUTE FUNCTION touch_category_atlas_updated_at();
CREATE TRIGGER touch_category_atlas_entries_updated_at BEFORE UPDATE ON public.category_atlas_entries FOR EACH ROW EXECUTE FUNCTION touch_category_atlas_updated_at();
CREATE TRIGGER touch_category_atlas_imports_updated_at BEFORE UPDATE ON public.category_atlas_imports FOR EACH ROW EXECUTE FUNCTION touch_category_atlas_updated_at();
CREATE TRIGGER update_development_projects_updated_at BEFORE UPDATE ON public.development_projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_candidate_updated BEFORE UPDATE ON public.idea_candidates FOR EACH ROW EXECUTE FUNCTION update_candidate_timestamp();
CREATE TRIGGER touch_market_curation_picks_updated_at BEFORE UPDATE ON public.market_curation_picks FOR EACH ROW EXECUTE FUNCTION touch_market_curation_updated_at();
CREATE TRIGGER touch_market_curation_runs_updated_at BEFORE UPDATE ON public.market_curation_runs FOR EACH ROW EXECUTE FUNCTION touch_market_curation_updated_at();
CREATE TRIGGER touch_npd_registry_products_updated_at BEFORE UPDATE ON public.npd_registry_products FOR EACH ROW EXECUTE FUNCTION touch_npd_registry_products_updated_at();
CREATE TRIGGER touch_opportunity_reviews_updated_at BEFORE UPDATE ON public.opportunity_reviews FOR EACH ROW EXECUTE FUNCTION touch_opportunity_operating_updated_at();
CREATE TRIGGER trg_link_atlas_entry_to_review AFTER INSERT OR UPDATE OF source ON public.opportunity_reviews FOR EACH ROW EXECUTE FUNCTION link_atlas_entry_to_review();
CREATE TRIGGER set_product_concepts_updated BEFORE UPDATE ON public.product_concepts FOR EACH ROW EXECUTE FUNCTION update_product_concepts_timestamp();
CREATE TRIGGER trg_concept_action_queue AFTER INSERT OR UPDATE OF status ON public.product_concepts FOR EACH ROW EXECUTE FUNCTION enqueue_concept_action();
CREATE TRIGGER trg_concept_status_rollup AFTER INSERT OR DELETE OR UPDATE OF status ON public.product_concepts FOR EACH ROW EXECUTE FUNCTION rollup_idea_stage_from_concepts();
CREATE TRIGGER trg_sync_greenlit_concept_to_npd_registry AFTER INSERT OR UPDATE OF status ON public.product_concepts FOR EACH ROW WHEN ((new.status = ANY (ARRAY['greenlit'::text, 'in_development'::text]))) EXECUTE FUNCTION sync_greenlit_concept_to_npd_registry();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
