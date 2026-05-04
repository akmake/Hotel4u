const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { createWorker } = require('tesseract.js');

// ── PDF renderer ──────────────────────────────────────────────
async function pdfToImages(pdfPath, scale = 2.5) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const images = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx,
      viewport,
      canvasFactory: {
        create: (w, h) => {
          const c = createCanvas(w, h);
          return { canvas: c, context: c.getContext('2d') };
        },
        reset: (obj, w, h) => {
          obj.canvas.width = w;
          obj.canvas.height = h;
        },
        destroy: () => {},
      },
    }).promise;

    images.push({ pageNum: i, canvas });
    process.stdout.write(`\r  ממיר דפים: ${i}/${pdf.numPages}`);
  }
  console.log();
  return images;
}

// ── זיהוי דף ביאור לפי צפיפות תוכן (דף ביאור = נקי יותר) ────
function isBiurPage(canvas) {
  // דף ביאור: שתי עמודות אחידות, רווח גדול בין הכותרת לגוף
  // דף וילנא: צפוף מאוד, הרבה אזורים שונים
  // נדגום פיקסלים לבדיקת צפיפות טקסט
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // בדוק את הרבע העליון — כותרת דף ביאור בהירה יותר
  const topData = ctx.getImageData(0, 0, w, Math.floor(h * 0.08)).data;
  let darkPixels = 0;
  for (let i = 0; i < topData.length; i += 4) {
    const brightness = (topData[i] + topData[i + 1] + topData[i + 2]) / 3;
    if (brightness < 128) darkPixels++;
  }
  const density = darkPixels / (topData.length / 4);

  // דף ביאור: כותרת דלילה יחסית (מספר + כותרת בלבד)
  // דף וילנא: כותרת צפופה עם עיצוב מורכב
  return density < 0.08;
}

// ── OCR לחצי דף (עמודה) ───────────────────────────────────────
async function ocrColumn(worker, canvas, x, y, w, h) {
  const col = createCanvas(w, h);
  col.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  const buf = col.toBuffer('image/png');
  const { data: { text } } = await worker.recognize(buf);
  return text.trim();
}

// ── חילוץ דף ביאור: עמודה ימנית + שמאלית ─────────────────────
async function extractBiurPage(worker, canvas) {
  const w = canvas.width;
  const h = canvas.height;

  // חתוך את אזור הכותרת (8% עליון) ואת ההערות (15% תחתון)
  const bodyY = Math.floor(h * 0.08);
  const bodyH = Math.floor(h * 0.77);

  // עמודה ימנית: x=50% עד x=100% (RTL — ימין קודם)
  const rightText = await ocrColumn(worker, canvas, Math.floor(w * 0.5), bodyY, Math.floor(w * 0.5), bodyH);
  // עמודה שמאלית: x=0 עד x=50%
  const leftText  = await ocrColumn(worker, canvas, 0, bodyY, Math.floor(w * 0.5), bodyH);

  return rightText + '\n' + leftText;
}

// ── ראשי ──────────────────────────────────────────────────────
async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('שימוש: node gemara_extract.js <נתיב.pdf>');
    process.exit(1);
  }

  console.log('▶ ממיר PDF לתמונות...');
  const images = await pdfToImages(pdfPath);

  console.log('▶ טוען מנוע OCR עברי...');
  const worker = await createWorker('heb');

  const results = [];
  let biurCount = 0;

  for (const { pageNum, canvas } of images) {
    const isBiur = isBiurPage(canvas);
    process.stdout.write(`  דף ${pageNum}: ${isBiur ? '✓ ביאור' : '○ מקור  '}\r`);

    if (isBiur) {
      const text = await extractBiurPage(worker, canvas);
      if (text.length > 50) {
        results.push(`--- דף ${pageNum} ---\n${text}`);
        biurCount++;
      }
    }
  }
  console.log(`\n▶ זוהו ${biurCount} דפי ביאור מתוך ${images.length}`);

  await worker.terminate();

  const output = results.join('\n\n');
  const outPath = pdfPath.replace(/\.pdf$/i, '_extracted.txt');
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`✓ נשמר: ${outPath}`);
  console.log('\n--- תצוגה מקדימה ---');
  console.log(output.slice(0, 600));
}

main().catch(console.error);
