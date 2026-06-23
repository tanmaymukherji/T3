import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateDocxBlob } from '../src/docx.js';

const outputDir = resolve('tmp', 'table-docx-qa');
await mkdir(outputDir, { recursive: true });

const blob = await generateDocxBlob([
  {
    page: 1,
    type: 'table',
    rows: [
      ['Name', 'Description', 'Quantity', 'Rate'],
      ['Asha', 'A longer translated description that should wrap neatly inside the cell', '12', '₹ 450'],
      ['Ravi', 'Second row\nwith a deliberate line break', '8', '₹ 325'],
    ],
  },
  { page: 2, text: 'The next source page begins here.' },
]);

const outputPath = resolve(outputDir, 'table-export-qa.docx');
await writeFile(outputPath, Buffer.from(await blob.arrayBuffer()));
console.log(outputPath);
