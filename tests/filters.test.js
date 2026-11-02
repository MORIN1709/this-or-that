import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, isStudioAlbum } from '../js/filters.js';

test('normalizeTitle strips parentheses, edition words and punctuation', () => {
  assert.equal(normalizeTitle('Master of Puppets (Remastered)'), 'master of puppets');
  assert.equal(normalizeTitle('Ride the Lightning [Deluxe Edition]'), 'ride the lightning');
  assert.equal(normalizeTitle('...And Justice for All'), 'and justice for all');
});

test('isStudioAlbum accepts a dated album with no secondary types', () => {
  assert.equal(isStudioAlbum({ title: 'Paranoid', 'first-release-date': '1970-09-18', 'secondary-types': [] }), true);
});

test('isStudioAlbum rejects live, undated, compilation and concert titles', () => {
  const base = { 'first-release-date': '1990-01-01', 'secondary-types': [] };
  assert.equal(isStudioAlbum({ ...base, title: 'Alive!', 'secondary-types': ['Live'] }), false);
  assert.equal(isStudioAlbum({ title: 'Paranoid', 'secondary-types': [] }), false);
  assert.equal(isStudioAlbum({ ...base, title: 'Greatest Hits' }), false);
  assert.equal(isStudioAlbum({ ...base, title: 'Live at Wembley' }), false);
  assert.equal(isStudioAlbum({ ...base, title: '1995-06-10: Cabaret Metro' }), false);
});
