/**
 * Exclusion matching in classifyHybridProduct, against the live scoring core.
 * Titles are from the 23 Oct 2026 coffee and Epicatechin runs.
 * Run: npm run test:scoring
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyHybridProduct, exclusionHit } from '../scoring_core.ts'

const product = (title, brand = '') => ({
  asin: 'B000000000', parent_asin: null, product_key: title, duplicate_asins: [], variant_count: 1,
  title, brand, price: null, rating: null, reviews: 0, monthly_sold: 0,
  bsr_current: null, bsr_avg30: null, bsr_avg90: null,
  classification: 'adjacent', missing_query_tokens: [], other_ingredient_hits: [],
})

const coffee = {
  frame: 'broad_hero', hero_ingredient: 'mushroom coffee', query_packet: [],
  include_terms: ['coffee', 'mushroom'], exclude_terms: ['ground coffee', 'k-cup', 'pods', 'whole bean'],
}
const epicatechin = {
  frame: 'broad_hero', hero_ingredient: 'epicatechin', query_packet: [],
  include_terms: ['epicatechin'], exclude_terms: ['cocoa powder', 'drink mix'],
}
const bucket = (frame, title) => classifyHybridProduct(frame, product(title)).bucket

test('frame exclusions match plurals and singulars', () => {
  assert.equal(bucket(coffee, 'Laird Superfood K-Cups with Functional Mushrooms'), 'excluded')
  assert.equal(bucket(coffee, 'Mushroom Coffee Pod Sampler'), 'excluded')
})

test('a multi-word frame exclusion allows one word in between', () => {
  assert.equal(bucket(coffee, 'Bulletproof The High Achiever Ground Mushroom Coffee, 10oz'), 'excluded')
  assert.equal(bucket(epicatechin, 'High Flavanol Cocoa Powder, 1200mg Cocoa Flavanols & 600mg Epicatechin'), 'excluded')
})

test('in-lane products stay included', () => {
  assert.equal(bucket(coffee, 'Four Sigmatic Organic Mushroom Coffee | Instant Mushroom Coffee Mix'), 'included')
  assert.equal(bucket(epicatechin, 'Nutricost Epicatechin (1,000mg) 60 Capsules'), 'included')
})

test('pet and topical noise always applies, plurals included', () => {
  assert.equal(bucket(epicatechin, 'Epicatechin Chews for Cats and Dogs'), 'excluded')
  assert.equal(bucket(epicatechin, 'Epicatechin Face Serums'), 'excluded')
})

test('noise patterns keep exact word order (no gap)', () => {
  assert.equal(exclusionHit(' essential fish oil ', 'essential oil'), false)
  assert.equal(exclusionHit(' lavender essential oils ', 'essential oil'), true)
})

test('two or more words in between do not match', () => {
  assert.equal(exclusionHit(' ground organic mushroom coffee ', 'ground coffee', true), false)
})

// From the 23 Oct 2026 Liposomal Iron run, where the model put the modifier in include_terms.
const liposomalIron = {
  frame: 'strict_modifier', hero_ingredient: 'iron', delivery_modifier: 'liposomal', query_packet: [],
  include_terms: ['iron', 'liposomal'], exclude_terms: ['gummies'],
}

test('a strict modifier frame needs the hero, not just the modifier', () => {
  assert.equal(bucket(liposomalIron, 'NutriFlair Liposomal Vitamin C 1700mg, 180 Capsules'), 'excluded')
  assert.equal(bucket(liposomalIron, 'Ferosom Forte LCE Liposomal Gentle Iron Supplement 30 mg, 30 Capsules'), 'included')
  assert.equal(bucket(liposomalIron, 'Gentle Iron Bisglycinate 25mg, 90 Capsules'), 'adjacent')
})
