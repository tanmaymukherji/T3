import { Document, Paragraph, TextRun, Packer, Table, TableRow, TableCell, TableBorders, BorderStyle, WidthType, TableLayoutType } from 'docx';
import fileSaver from 'file-saver';

const { saveAs } = fileSaver;

const border = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
const tableBorders = new TableBorders({
  top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border,
});

const USABLE_PAGE_WIDTH = 9360;

function normalizedTableRows(rows) {
  const colCount = Math.max(1, ...rows.map((row) => row?.length || 0));
  return rows.map((row) => Array.from({ length: colCount }, (_, index) => String(row?.[index] ?? '')));
}

function computeColumnWidths(rows) {
  const colCount = rows[0]?.length || 1;
  const weights = Array.from({ length: colCount }, (_, column) => {
    const longest = Math.max(1, ...rows.map((row) => Math.min(60, (row[column] || '').length)));
    return Math.max(8, longest);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const minimum = Math.min(1100, Math.floor(USABLE_PAGE_WIDTH / colCount));
  let widths = weights.map((weight) => Math.max(minimum, Math.round(USABLE_PAGE_WIDTH * weight / total)));
  const widthTotal = widths.reduce((sum, width) => sum + width, 0);
  widths = widths.map((width) => Math.floor(width * USABLE_PAGE_WIDTH / widthTotal));
  widths[widths.length - 1] += USABLE_PAGE_WIDTH - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

function cellParagraph(text, isHeader) {
  const lines = String(text || '').split('\n');
  const children = [];
  lines.forEach((line, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));
    children.push(new TextRun({ text: line, size: 20, font: 'Calibri', bold: isHeader }));
  });
  return new Paragraph({ spacing: { after: 0, line: 260 }, children });
}

function buildParagraphs(items) {
  const children = [];
  for (let i = 0; i < items.length; i++) {
    const { text, isPageStart, type, rows } = items[i];

    if (type === 'table' && rows && rows.length > 0) {
      const normalizedRows = normalizedTableRows(rows);
      const columnWidths = computeColumnWidths(normalizedRows);
      if (isPageStart && children.length > 0) {
        children.push(new Paragraph({ pageBreakBefore: true }));
      }
      const tableRows = normalizedRows.map((row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          cantSplit: true,
          children: row.map((cellText, columnIndex) =>
            new TableCell({
              children: [cellParagraph(cellText, rowIndex === 0)],
              width: { size: columnWidths[columnIndex], type: WidthType.DXA },
              margins: { top: 90, bottom: 90, left: 110, right: 110 },
              shading: rowIndex === 0 ? { fill: 'EAF0F7' } : undefined,
            })
          ),
        })
      );
      children.push(new Table({
        rows: tableRows,
        borders: tableBorders,
        width: { size: USABLE_PAGE_WIDTH, type: WidthType.DXA },
        columnWidths,
        layout: TableLayoutType.FIXED,
      }));
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
