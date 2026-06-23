import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTableBlocks } from '../src/table-structure.js';

function word(text, x0, y0, width = 48, height = 20) {
  return { text, confidence: 95, bbox: { x0, y0, x1: x0 + width, y1: y0 + height } };
}

test('reconstructs a scanned table as one structured block', () => {
  const words = [
    word('Name', 20, 20), word('Age', 210, 20), word('City', 350, 20),
    word('Asha', 20, 60), word('34', 210, 60), word('Delhi', 350, 60),
    word('Ravi', 20, 100), word('41', 210, 100), word('Pune', 350, 100),
  ];
  const tables = detectTableBlocks(words);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].type, 'table');
  assert.deepEqual(tables[0].rows, [
    ['Name', 'Age', 'City'],
    ['Asha', '34', 'Delhi'],
    ['Ravi', '41', 'Pune'],
  ]);
  assert.equal(tables[0].text, 'Name\tAge\tCity\nAsha\t34\tDelhi\nRavi\t41\tPune');
});

test('accepts a compact two-row table when three columns align', () => {
  const words = [
    word('Item', 10, 10), word('Qty', 180, 10), word('Rate', 320, 10),
    word('Rice', 10, 45), word('5', 180, 45), word('40', 320, 45),
  ];
  const tables = detectTableBlocks(words);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].colCount, 3);
});

test('does not turn ordinary prose into a table', () => {
  const words = [
    word('This', 20, 20, 38), word('is', 66, 20, 15), word('a', 89, 20, 8), word('sentence', 105, 20, 72),
    word('Another', 20, 52, 62), word('normal', 90, 52, 55), word('line', 153, 52, 30),
    word('Final', 20, 84, 40), word('paragraph', 68, 84, 76), word('line', 152, 84, 30),
  ];
  assert.deepEqual(detectTableBlocks(words), []);
});
