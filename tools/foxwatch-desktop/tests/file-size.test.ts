import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareFileSizes, formatFileSize } from '../shared/file-size.ts';

test('file size changes compare working bytes to approved bytes', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1024), '1 KiB');
  assert.equal(formatFileSize(1024 ** 2), '1 MiB');
  assert.deepEqual(compareFileSizes(1024,1536), {delta:512,label:'+512 B (+50%)',exact:'+512 B'});
  assert.equal(compareFileSizes(2048,1024).label, '−1 KiB (−50%)');
  assert.equal(compareFileSizes(10_000_000,10_000_001).label, '+1 B (+<0.01%)');
  assert.equal(compareFileSizes(100,100).label, 'No Size Change');
});

test('missing and empty files have distinct size summaries without invalid percentages', () => {
  assert.equal(compareFileSizes(null,100).label, 'Added · +100 B');
  assert.equal(compareFileSizes(100,null).label, 'Deleted · −100 B');
  assert.equal(compareFileSizes(null,0).label, 'Added · 0 B');
  assert.equal(compareFileSizes(0,null).label, 'Deleted · 0 B');
  assert.equal(compareFileSizes(0,100).label, '+100 B · Previously Empty');
  assert.equal(compareFileSizes(100,0).label, '−100 B (−100%)');
  assert.equal(compareFileSizes(0,0).label, 'No Size Change');
  assert.equal(compareFileSizes(null,null).label, 'No File');
});
