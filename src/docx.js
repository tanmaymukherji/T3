import { Document, Paragraph, TextRun, Packer, Table, TableRow, TableCell, TableBorders, BorderStyle, WidthType } from 'docx';
import { saveAs } from 'file-saver';

const border = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
const tableBorders = new TableBorders({
  top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border,
});

function buildParagraphs(items) {
  const children = [];
  for (let i = 0; i < items.length; i++) {
    const { text, isPageStart, type, rows } = items[i];

    if (type === 'table' && rows && rows.length > 0) {
      const tableRows = rows.map((row) =>
        new TableRow({
          children: (row || []).map((cellText) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cellText || '', size: 20, font: 'Calibri' })] })],
              width: { size: 100 / (row.length || 1), type: WidthType.PERCENTAGE },
            })
          ),
        })
      );
      children.push(new Table({ rows: tableRows, borders: tableBorders }));
      continue;
    }

    const runs = [];
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) {
        runs.push(new TextRun({ break: 1 }));
      }
      runs.push(new TextRun({ text: lines[li], size: 22, font: 'Calibri' }));
    }
    const opts = { spacing: { after: 200, line: 360 }, children: runs };
    if (isPageStart && i > 0) {
      opts.pageBreakBefore = true;
    }
    children.push(new Paragraph(opts));
  }
  return children;
}

export async function generateDocx(paragraphs, filename) {
  const blob = await generateDocxBlob(paragraphs);
  saveAs(blob, filename);
  return blob;
}

export async function generateDocxBlob(paragraphs) {
  const items = [];
  let lastPage = null;
  for (const p of paragraphs) {
    const text = (p.translated !== undefined ? p.translated : p.text || '').replace(/<[^>]+>/g, '').trim();

    if (p.type === 'table') {
      const rows = p.rows || text.split('\n').map(l => l.split('\t'));
      const translatedRows = p.translated !== undefined
        ? p.translated.split('\n').map(l => l.split('\t'))
        : rows;
      items.push({ type: 'table', rows: translatedRows, isPageStart: lastPage !== null && p.page !== lastPage });
      lastPage = p.page;
      continue;
    }

    if (!text) continue;
    items.push({ text, isPageStart: lastPage !== null && p.page !== lastPage });
    lastPage = p.page;
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: buildParagraphs(items),
    }],
  });

  return await Packer.toBlob(doc);
}

export async function generateDocxFromHtml(htmlContent, filename) {
  const paraRegex = /<p[^>]*>(.*?)<\/p>/gs;
  const matches = [];
  let match;
  let page = 1;
  while ((match = paraRegex.exec(htmlContent)) !== null) {
    const pageAttr = match[0].match(/data-page="(\d+)"/);
    if (pageAttr) page = parseInt(pageAttr[1], 10);
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text) matches.push({ text, page });
  }

  if (matches.length === 0) {
    const text = htmlContent.replace(/<[^>]+>/g, '').trim();
    if (text) matches.push({ text, page: 1 });
  }

  return generateDocx(matches, filename);
}
