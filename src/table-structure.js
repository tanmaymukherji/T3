function validBbox(bbox) {
  return bbox && [bbox.x0, bbox.y0, bbox.x1, bbox.y1].every(Number.isFinite)
    && bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0;
}

function unionBboxes(items) {
  const boxes = items.map((item) => item.bbox || item).filter(validBbox);
  if (boxes.length === 0) return undefined;
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function collectTesseractWords(blocks = []) {
  const words = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          const text = (word.text || '').trim();
          if (!text || !validBbox(word.bbox)) continue;
          words.push({
            text,
            bbox: { ...word.bbox },
            confidence: Number.isFinite(word.confidence) ? word.confidence : null,
          });
        }
      }
    }
  }
  return words;
}

export function clusterWordsIntoRows(inputWords = []) {
  const words = inputWords
    .filter((word) => word.text?.trim() && validBbox(word.bbox))
    .map((word) => ({
      ...word,
      centerY: (word.bbox.y0 + word.bbox.y1) / 2,
      height: word.bbox.y1 - word.bbox.y0,
    }))
    .sort((a, b) => a.centerY - b.centerY || a.bbox.x0 - b.bbox.x0);

  const rows = [];
  for (const word of words) {
    let bestRow = null;
    let bestDistance = Infinity;
    for (let i = Math.max(0, rows.length - 3); i < rows.length; i++) {
      const row = rows[i];
      const overlap = Math.max(0, Math.min(row.bbox.y1, word.bbox.y1) - Math.max(row.bbox.y0, word.bbox.y0));
      const minHeight = Math.min(row.height, word.height);
      const distance = Math.abs(row.centerY - word.centerY);
      if ((overlap >= minHeight * 0.35 || distance <= Math.max(row.height, word.height) * 0.55) && distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }

    if (!bestRow) {
      rows.push({ words: [word], bbox: { ...word.bbox }, centerY: word.centerY, height: word.height });
      continue;
    }

    bestRow.words.push(word);
    bestRow.bbox = unionBboxes(bestRow.words);
    bestRow.centerY = (bestRow.bbox.y0 + bestRow.bbox.y1) / 2;
    bestRow.height = bestRow.bbox.y1 - bestRow.bbox.y0;
  }

  return rows
    .map((row) => ({ ...row, words: row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0) }))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function splitRowIntoCells(row) {
  const words = row.words;
  if (words.length < 2) return [{ words, bbox: row.bbox, text: words.map((word) => word.text).join(' ') }];
  const heights = words.map((word) => word.height);
  const typicalHeight = median(heights) || row.height || 10;
  const gaps = words.slice(1).map((word, index) => word.bbox.x0 - words[index].bbox.x1);
  const smallGaps = gaps.filter((gap) => gap >= 0 && gap <= typicalHeight * 1.5);
  const ordinaryGap = median(smallGaps) || typicalHeight * 0.35;
  const splitThreshold = Math.max(typicalHeight * 1.6, ordinaryGap * 3, 18);

  const cells = [];
  let current = [words[0]];
  for (let i = 1; i < words.length; i++) {
    if (gaps[i - 1] >= splitThreshold) {
      cells.push(current);
      current = [];
    }
    current.push(words[i]);
  }
  cells.push(current);

  return cells.map((cellWords) => ({
    words: cellWords,
    bbox: unionBboxes(cellWords),
    text: cellWords.map((word) => word.text).join(' '),
  }));
}

function clusterAnchors(candidateRows, tolerance) {
  const clusters = [];
  candidateRows.forEach((row, rowIndex) => {
    row.cells.forEach((cell) => {
      const x = cell.bbox.x0;
      let cluster = clusters.find((item) => Math.abs(item.x - x) <= tolerance);
      if (!cluster) {
        cluster = { x, values: [], rowIndexes: new Set() };
        clusters.push(cluster);
      }
      cluster.values.push(x);
      cluster.rowIndexes.add(rowIndex);
      cluster.x = median(cluster.values);
    });
  });
  return clusters.sort((a, b) => a.x - b.x);
}

function makeTable(candidateRows) {
  const typicalHeight = median(candidateRows.map((row) => row.height)) || 12;
  const tolerance = Math.max(18, typicalHeight * 1.8);
  const anchors = clusterAnchors(candidateRows, tolerance);
  const minSupport = Math.max(2, Math.ceil(candidateRows.length * 0.6));
  const supported = anchors.filter((anchor) => anchor.rowIndexes.size >= minSupport);
  if (supported.length < 2) return null;
  if (candidateRows.length < 3 && supported.length < 3) return null;

  const anchorXs = supported.map((anchor) => anchor.x);
  const boundaries = anchorXs.slice(0, -1).map((x, index) => (x + anchorXs[index + 1]) / 2);
  const rows = [];
  const cells = [];

  candidateRows.forEach((row, rowIndex) => {
    const columns = anchorXs.map(() => []);
    row.words.forEach((word) => {
      const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
      let column = boundaries.findIndex((boundary) => centerX < boundary);
      if (column === -1) column = anchorXs.length - 1;
      columns[column].push(word);
    });
    const textRow = columns.map((columnWords, column) => {
      const text = columnWords.map((word) => word.text).join(' ').trim();
      cells.push({
        row: rowIndex,
        col: column,
        text,
        bbox: unionBboxes(columnWords),
        confidence: columnWords.length
          ? columnWords.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / columnWords.length
          : null,
      });
      return text;
    });
    rows.push(textRow);
  });

  const nonEmptyPerRow = rows.map((row) => row.filter(Boolean).length);
  if (nonEmptyPerRow.filter((count) => count >= 2).length < minSupport) return null;

  const bbox = unionBboxes(candidateRows);
  return {
    type: 'table',
    rows,
    colCount: anchorXs.length,
    text: rows.map((row) => row.join('\t')).join('\n'),
    bbox,
    cells,
    lines: [],
  };
}

export function detectTableBlocks(words = []) {
  const visualRows = clusterWordsIntoRows(words).map((row) => ({ ...row, cells: splitRowIntoCells(row) }));
  const groups = [];
  let current = [];

  const flush = () => {
    if (current.length >= 2) groups.push(current);
    current = [];
  };

  for (const row of visualRows) {
    if (row.cells.length < 2) {
      flush();
      continue;
    }
    if (current.length) {
      const previous = current[current.length - 1];
      const maxGap = Math.max(previous.height, row.height) * 3.5;
      if (row.bbox.y0 - previous.bbox.y1 > maxGap) flush();
    }
    current.push(row);
  }
  flush();

  return groups.map(makeTable).filter(Boolean);
}

export function bboxOverlapRatio(a, b) {
  if (!validBbox(a) || !validBbox(b)) return 0;
  const width = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const height = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = width * height;
  const area = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  return intersection / area;
}

export { unionBboxes };
