const fs = require('fs');

const hebrewMapStr = `const hebrewMap = {
  0xe0: 'א', 0x2021: 'א', 0xe1: 'ב', 0x00B7: 'ב', 0xe2: 'ג', 0x201A: 'ג', 0xe3: 'ד', 0x201E: 'ד',
  0xe4: 'ה', 0x2030: 'ה', 0xe5: 'ו', 0x00C2: 'ו', 0xe6: 'ז', 0x00CA: 'ז', 0xe7: 'ח', 0x00C1: 'ח',
  0xe8: 'ט', 0x00CB: 'ט', 0xe9: 'י', 0x00C8: 'י', 0xC8: 'י', 0xea: 'ך', 0x00CD: 'ך', 0xCD: 'ך',
  0xeb: 'כ', 0x00CE: 'כ', 0xec: 'ל', 0x00CF: 'ל', 0xCF: 'ל', 0xed: 'ם', 0x00CC: 'ם',
  0xee: 'מ', 0x00D3: 'מ', 0xD3: 'מ', 0xef: 'ן', 0x00D4: 'ן', 0xf0: 'נ', 0xF8FF: 'נ',
  0xf1: 'ס', 0x00D2: 'ס', 0xf2: 'ע', 0x00DA: 'ע', 0xf3: 'ף', 0x00DB: 'ף', 0xf4: 'פ', 0x00D9: 'פ', 0xD9: 'פ',
  0xf5: 'ץ', 0x0131: 'ץ', 0xf6: 'צ', 0x02C6: 'צ', 0xf7: 'ק', 0x02DC: 'ק', 0xf8: 'ר', 0x00AF: 'ר',
  0xf9: 'ש', 0x02D8: 'ש', 0xfa: 'ת', 0x02D9: 'ת'
};

function fixHebrew(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (hebrewMap[code]) out += hebrewMap[code];
    else out += text[i];
  }
  return out;
}
`;

const extractOcrStr = `
async function extractOCR(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const numPages = pdf.numPages;

  let allParagraphs = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress?.(0, i, numPages);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    let items = content.items.map(item => {
       item.y = Math.round(item.transform[5]);
       item.x = Math.round(item.transform[4]);
       item.fixedText = fixHebrew(item.str);
       return item;
    });

    items.sort((a,b) => {
       if (Math.abs(b.y - a.y) > 5) return b.y - a.y;
       return b.x - a.x;
    });

    let lines = [];
    let currentLine = [];
    let lastY = -1000;

    for (const item of items) {
       if (Math.abs(item.y - lastY) > 5 && currentLine.length > 0) {
           lines.push(currentLine.join(''));
           currentLine = [];
       }
       currentLine.push(item.fixedText);
       lastY = item.y;
    }
    if (currentLine.length > 0) lines.push(currentLine.join(''));

    for (let line of lines) {
       if (!line || line.trim() === '') continue;
       let reversed = line.split('').reverse().join('').trim();

       if (/^\\d{1,4}$/.test(reversed)) continue;
       if (reversed.includes('ספר המאמרים') || reversed.includes('תשכ"ד')) continue;

       if (/^\\d{1,3}\\)/.test(reversed)) continue; 
       if (/^\\(\\d{1,3}/.test(reversed)) continue; 
       if (/^[א-ת]{1,2}\\)/.test(reversed)) continue;

       if (reversed.includes('ראה לעיל')) continue;
       if (reversed.includes('ראה לקמן')) continue;
       if (reversed.startsWith('נדפס (אה"ז)')) continue;
       if (reversed.startsWith('בשולי הגליון')) continue;

       reversed = reversed.replace(/[1-9]{1,2}(?=[ ,\\.\\(\\)\\u05D0-\\u05EA]|$)/g, '');
       reversed = reversed.replace(/[\\(\\)]/g, '');
       reversed = reversed.replace(/\\s{2,}/g, ' ').trim();

       if (reversed.length < 2) continue;

       allParagraphs.push(reversed);
    }
  }

  let paragraphs = [];
  let currentPara = [];
  for (let l of allParagraphs) {
     currentPara.push(l);
     if (l.endsWith('.') || l.endsWith(':') || l.endsWith(';')) {
        paragraphs.push(currentPara.join(' '));
        currentPara = [];
     }
  }
  if(currentPara.length > 0) paragraphs.push(currentPara.join(' '));

  return { text: paragraphs.join('\\n\\n'), numPages };
}
`;

let content = fs.readFileSync('client/src/pages/AdminPage.jsx', 'utf8');

// remove worker import
content = content.replace("import { createWorker } from 'tesseract.js';", "");

// replace everything from `async function extractOCR` to `return { text: full, numPages };\n}`
const startMarker = "async function extractOCR";
const endMarker = "return { text: full, numPages };\n}";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker) + endMarker.length;

if (startIndex === -1 || endIndex === -1) {
    console.error("Could not find extractOCR function block.");
    process.exit(1);
}

const before = content.slice(0, startIndex);
const after = content.slice(endIndex);

const newContent = before + "\n" + hebrewMapStr + "\n" + extractOcrStr + "\n" + after;

fs.writeFileSync('client/src/pages/AdminPage.jsx', newContent, 'utf8');
console.log("Successfully patched AdminPage.jsx");
