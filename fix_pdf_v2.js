const { extractText } = require('./server/utils/pdfExtract.cjs');
const fs = require('fs');
const path = require('path');

const hebrewMap = {
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

async function run() {
  try {
    const files = fs.readdirSync('c:/Users/yosef/Downloads');
    const target = files.find(f => f.includes('22') && f.includes('pdf'));
    const fullPath = path.join('c:/Users/yosef/Downloads', target);
    
    global.DOMMatrix = class DOMMatrix {
      constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; }
      multiply() { return this; }
      translate() { return this; }
      scale() { return this; }
    };
    
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(fullPath)) }).promise;
    
    let allParagraphs = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      let items = content.items.map(item => {
         item.y = Math.round(item.transform[5]); 
         item.x = Math.round(item.transform[4]);
         item.fixedText = fixHebrew(item.str);
         return item;
      });
      
      // Top down (Y descending) -> PDF coordinate Y is 0 at bottom usually, so large Y is at the top.
      // Right to left (X descending) -> RTL languages
      items.sort((a,b) => {
         if (Math.abs(b.y - a.y) > 5) {
            return b.y - a.y; // larger Y first
         }
         return b.x - a.x; // larger X first
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
         
         if (/^\d{1,4}$/.test(reversed)) continue; 
         if (reversed.includes('ספר המאמרים') || reversed.includes('תשכ"ד')) continue;
         
         // Fix footnote check
         // We check if it ends with period or if it has the structure 1), or a)
         if (/^\d{1,3}\)/.test(reversed)) continue; // e.g. "1) "
         if (/^\(\d{1,3}/.test(reversed)) continue; // e.g. "(1"
         if (/^[א-ת]{1,2}\)/.test(reversed)) continue; 
         
         // additional heuristics for footnotes since we might have stripped out parenthesis previously
         if (reversed.includes('ראה לעיל')) continue;
         if (reversed.includes('ראה לקמן')) continue;
         if (reversed.startsWith('נדפס (לאח"ז)')) continue;
         if (reversed.startsWith('בשולי הגליון')) continue;
         
         // Remove inline footnote markers like "2(" -> "2" or "(2"
         reversed = reversed.replace(/[1-9]{1,2}(?=[ ,\.\(\)\u05D0-\u05EA]|$)/g, '');
         reversed = reversed.replace(/[\(\)]/g, ''); 
         reversed = reversed.replace(/\s{2,}/g, ' ').trim();
         
         if (reversed.length < 2) continue;
         
         allParagraphs.push(reversed);
      }
    }
    
    // Combine lines into proper paragraphs
    let paragraphs = [];
    let currentPara = [];
    for (let l of allParagraphs) {
       currentPara.push(l);
       // End of sentence markers in Hebrew
       if (l.endsWith('.') || l.endsWith(':') || l.endsWith(';')) {
          paragraphs.push(currentPara.join(' '));
          currentPara = [];
       }
    }
    if(currentPara.length > 0) paragraphs.push(currentPara.join(' '));
    
    let textOut = paragraphs.join('\n\n');
    fs.writeFileSync('extracted_article.txt', textOut, 'utf8');
    console.log('Saved! Paragraphs count:', paragraphs.length);
  } catch (err) {
    console.error(err);
  }
}
run();