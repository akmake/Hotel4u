import * as mupdf from 'mupdf';
import { createCanvas, Image } from 'canvas';
import { createWorker } from 'tesseract.js';
import fs from 'fs';

const PDF_PATH = 'C:/Users/yosef dahan/Downloads/בדיקה.pdf';
const SCALE = 2.5;

function pdfToBuffers(pdfBuffer) {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const count = doc.countPages();
  const pages = [];
  for (let i = 0; i < count; i++) {
    const page = doc.loadPage(i);
    const bounds = page.getBounds();
    const width  = Math.round((bounds[2] - bounds[0]) * SCALE);
    const height = Math.round((bounds[3] - bounds[1]) * SCALE);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuf = Buffer.from(pixmap.asPNG());
    pages.push({ pageNum: i + 1, pngBuf, width, height, total: count });
  }
  return pages;
}

function getDensity(pngBuf, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.src = pngBuf;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, width, Math.floor(height * 0.08)).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] + data[i+1] + data[i+2]) / 3 < 128) dark++;
  }
  return dark / (data.length / 4);
}

async function main() {
  console.log('▶ ממיר PDF...');
  const pages = pdfToBuffers(fs.readFileSync(PDF_PATH));
  console.log(`  ${pages.length} דפים\n`);

  console.log('▶ זיהוי דפים:');
  for (const { pageNum, pngBuf, width, height } of pages) {
    const density = getDensity(pngBuf, width, height);
    console.log(`  דף ${pageNum}: צפיפות=${density.toFixed(4)} → ${density < 0.08 ? '✓ ביאור' : '✗ מקור'}`);
  }

  const worker = await createWorker('heb');

  for (const { pageNum, pngBuf, width, height } of pages) {
    console.log(`\n▶ OCR דף ${pageNum} — עמודה ימנית:`);
    const halfW = Math.floor(width / 2);
    const bodyTop = Math.floor(height * 0.08);
    const bodyH   = Math.floor(height * 0.77);

    const { data: { text } } = await worker.recognize(pngBuf, {
      rectangle: { left: halfW, top: bodyTop, width: halfW, height: bodyH }
    });
    console.log(text.slice(0, 400));
    fs.writeFileSync(`debug_ocr_page${pageNum}_right.txt`, text, 'utf8');
  }

  await worker.terminate();
  console.log('\nסיום. קבצים נשמרו.');
}

main().catch(console.error);
