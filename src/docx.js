// Client-side DOCX generation using docx library
// https://docx.js.org/

import { Document, Paragraph, TextRun, Packer } from 'docx';
import { saveAs } from 'file-saver';

export async function generateDocx(paragraphs, filename) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs.map((text) => {
          const cleanText = text.replace(/<[^>]+>/g, '').trim();
          return new Paragraph({
            children: [
              new TextRun({
                text: cleanText,
                size: 22, // ~11pt
                font: 'Calibri',
              }),
            ],
            spacing: { after: 200 },
          });
        }),
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
  return blob;
}

export async function generateDocxFromHtml(htmlContent, filename) {
  // Parse <p> tags
  const paraRegex = /<p[^>]*>(.*?)<\/p>/gs;
  const matches = [];
  let match;
  while ((match = paraRegex.exec(htmlContent)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text) matches.push(text);
    else matches.push('');
  }

  if (matches.length === 0) {
    const text = htmlContent.replace(/<[^>]+>/g, '').trim();
    if (text) matches.push(text);
  }

  return generateDocx(matches, filename);
}
