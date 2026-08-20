#!/usr/bin/env node
/**
 * Phase B golden-set replay — offline regression against frozen fixtures.
 *
 * Usage: node eval/golden-set/replay.mjs
 *        npm run eval:phase-b
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPhaseBDeterministicCore } from '../../supabase/functions/_shared/scoring_core.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')

function listFixtureSlugs() {
  if (!statSync(FIXTURES_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    return []
  }
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function diffValues(path, expected, actual, out) {
  if (Object.is(expected, actual)) return

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push(`${path}: array length expected ${expected.length}, got ${actual.length}`)
      return
    }
    for (let i = 0; i < expected.length; i += 1) {
      diffValues(`${path}[${i}]`, expected[i], actual[i], out)
    }
    return
  }

  if (isObject(expected) && isObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    for (const key of keys) {
      if (!(key in expected)) {
        out.push(`${path}.${key}: unexpected field in actual`)
        continue
      }
      if (!(key in actual)) {
        out.push(`${path}.${key}: missing in actual`)
        continue
      }
      diffValues(`${path}.${key}`, expected[key], actual[key], out)
    }
    return
  }

  out.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function runFixture(slug) {
  const dir = join(FIXTURES_DIR, slug)
  const inputs = loadJson(join(dir, 'inputs.json'))
  const expected = loadJson(join(dir, 'expected.json'))
  const actual = runPhaseBDeterministicCore(inputs)
  const diffs = []
  diffValues('$', expected, actual, diffs)
  return { slug, diffs, actual }
}

function main() {
  const slugs = listFixtureSlugs()
  if (slugs.length === 0) {
    console.log('phase-b golden-set: no fixtures found (add directories under eval/golden-set/fixtures/)')
    process.exit(0)
  }

  let failed = 0
  for (const slug of slugs) {
    const { diffs } = runFixture(slug)
    if (diffs.length === 0) {
      console.log(`ok  ${slug}`)
      continue
    }
    failed += 1
    console.error(`FAIL ${slug}`)
    for (const line of diffs.slice(0, 40)) {
      console.error(`  ${line}`)
    }
    if (diffs.length > 40) {
      console.error(`  ... and ${diffs.length - 40} more diffs`)
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${slugs.length} fixture(s) failed`)
    process.exit(1)
  }

  console.log(`\n${slugs.length} fixture(s) passed`)
  process.exit(0)
}

main()
