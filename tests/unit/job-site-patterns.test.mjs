// tests/unit/job-site-patterns.test.mjs
//
// Round-95 (mobile in-app browser) — locks the URL-pattern matcher in
// lib/job-site-patterns.js: the known job-board / ATS host suffix list,
// hostname normalisation, isKnownJobSite() fail-closed behaviour,
// jobSiteLabel(), and the address-bar normalizeUrl() helper.
//
// Run via `yarn test:unit` (`node --test tests/unit/**`).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  JOB_SITE_HOST_SUFFIXES,
  hostnameOf,
  isKnownJobSite,
  jobSiteLabel,
  normalizeUrl,
} from '../../lib/job-site-patterns.js'

test('JOB_SITE_HOST_SUFFIXES covers the Swedish boards + major ATS platforms', () => {
  for (const host of [
    'arbetsformedlingen.se',
    'jobbland.se',
    'ledigajobb.se',
    'jobbsafari.se',
    'metrojobb.se',
    'monster.se',
    'teamtailor.com',
    'reachmee.com',
    'greenhouse.io',
    'lever.co',
    'workday.com',
    'myworkdayjobs.com',
    'smartrecruiters.com',
    'recruitee.com',
  ]) {
    assert.ok(JOB_SITE_HOST_SUFFIXES.includes(host), `${host} must be a known suffix`)
  }
})

test('hostnameOf strips scheme, www, port, path and lowercases', () => {
  assert.equal(hostnameOf('https://www.Ledigajobb.se/annonser/1'), 'ledigajobb.se')
  assert.equal(hostnameOf('HTTP://Jobbland.SE/jobb'), 'jobbland.se')
  assert.equal(hostnameOf('https://jobs.acme.se.teamtailor.com/jobs/123'), 'jobs.acme.se.teamtailor.com')
})

test('hostnameOf returns empty for non-http(s) or malformed input', () => {
  assert.equal(hostnameOf(''), '')
  assert.equal(hostnameOf(null), '')
  assert.equal(hostnameOf(undefined), '')
  assert.equal(hostnameOf('not a url'), '')
  assert.equal(hostnameOf('ftp://example.com'), '')
  assert.equal(hostnameOf('javascript:alert(1)'), '')
})

test('isKnownJobSite matches known hosts + subdomains', () => {
  assert.equal(isKnownJobSite('https://ledigajobb.se/jobb'), true)
  assert.equal(isKnownJobSite('https://www.ledigajobb.se/jobb'), true)
  assert.equal(isKnownJobSite('https://jobs.example.teamtailor.com/jobs/1'), true)
  assert.equal(isKnownJobSite('https://boards.greenhouse.io/acme/jobs/1'), true)
  assert.equal(isKnownJobSite('https://jobbland.se/sok?q=x'), true)
})

test('isKnownJobSite fails closed for unknown / empty hosts', () => {
  assert.equal(isKnownJobSite('https://example.com'), false)
  assert.equal(isKnownJobSite('https://notjobbland.se'), false)
  assert.equal(isKnownJobSite(''), false)
  assert.equal(isKnownJobSite(null), false)
  assert.equal(isKnownJobSite('evil-teamtailor.com'), false, 'a suffix must be a full domain label, not a substring')
})

test('jobSiteLabel returns a canonical label or empty', () => {
  assert.equal(jobSiteLabel('https://www.ledigajobb.se/jobb'), 'Ledigajobb')
  assert.equal(jobSiteLabel('https://jobbland.se/x'), 'Jobbland')
  assert.equal(jobSiteLabel('https://jobs.acme.teamtailor.com/jobs/1'), 'Teamtailor')
  assert.equal(jobSiteLabel('https://example.com'), '')
  assert.equal(jobSiteLabel(''), '')
})

test('normalizeUrl prepends https when no scheme is present', () => {
  assert.equal(normalizeUrl('ledigajobb.se'), 'https://ledigajobb.se')
  assert.equal(normalizeUrl('  jobbland.se/jobb  '), 'https://jobbland.se/jobb')
  assert.equal(normalizeUrl('https://already.example.com'), 'https://already.example.com')
  assert.equal(normalizeUrl('http://already.example.com'), 'http://already.example.com')
})

test('normalizeUrl returns empty for blank input', () => {
  assert.equal(normalizeUrl(''), '')
  assert.equal(normalizeUrl('   '), '')
  assert.equal(normalizeUrl(null), '')
  assert.equal(normalizeUrl(undefined), '')
})
