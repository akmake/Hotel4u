const { extractText } = require('./server/utils/pdfExtract.cjs');
const fs = require('fs');

const hebrewMap = {
  0xe0: 'א', 0xe1: 'ב', 0xe2: 'ג', 0xe3: 'ד', 0xe4: 'ה', 0xe5: 'ו', 0xe6: 'ז', 0xe7: 'ח', 0xe8: 'ט',
  0xc8: 'י', 0xe9: 'י', 0xca: 'ך', 0xcd: 'ך', 0xcb: 'כ', 0xce: 'ל', 0xcf: 'ל', 0xcc: 'ם', 0xd0: 'ם',
  0xcd: 'מ', 0xd3: 'מ', 0xce: 'ן', 0xd4: 'ן', 0xcf: 'נ', 0xd2: 'ס', 0xd3: 'ע', 0xd4: 'ף', 0xd5: 'פ', 
  // Let's rely strictly on empirical mapping:
  0xe0: 'א', 0x2021: 'א',
  0xe1: 'ב', 0x00B7: 'ב',
  0xe2: 'ג', 0x201A: 'ג',
  0xe3: 'ד', 0x201E: 'ד',
  0xe4: 'ה', 0x2030: 'ה',
  0xe5: 'ו', 0x00C2: 'ו',
  0xe6: 'ז', 0x00CA: 'ז',
  0xe7: 'ח', 0x00C1: 'ח',
  0xe8: 'ט', // 0x00CB
  0xe9: 'י', 0x00C8: 'י',
  0xca: 'ך', 0x00CD: 'ך',
  0xcb: 'כ', 0x00CE: 'כ',
  0xcc: 'ל', 0x00CF: 'ל',
  0xcd: 'ם', 0x00CC: 'ם',
  0xce: 'מ', 0x00D3: 'מ',
  0xcf: 'ן', 0x00D4: 'ן',
  0xf0: 'נ', 0xF8FF: 'נ',
  0xf1: 'ס', 0x00D2: 'ס',
  0xf2: 'ע', 0x00DA: 'ע',
  0xf3: 'ף', 0x00DB: 'ף',
  0xf4: 'פ', 0x00D9: 'פ',
  0xf5: 'ץ', 0x0131: 'ץ',
  0xf6: 'צ', 0x02C6: 'צ',
  0xf7: 'ק', 0x02DC: 'ק',
  0xf8: 'ר', 0x00AF: 'ר',
  0xf9: 'ש', 0x02D8: 'ש',
  0xfa: 'ת', 0x02D9: 'ת'
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

// reverses strings that are Hebrew letters only
function reverseHebrewLine(line) {
  return line.split(' ').map(word => {
    // Check if word contains hebrew. If so, reverse it
    if (/[\u0590-\u05FF]/.test(word)) {
      return word.split('').reverse().join('');
    }
    return word;
  }).reverse().join(' ');
}

async function run() {
  try {
    const buf = fs.readFileSync('c:/Users/yosef/Downloads/22 מאמר דה מזמור גו\' צמאה לך נפשי, שפ צו, שבת-הגדול, ח\' ניסן (ב).pdf');
    const result = await extractText(buf);
    
    const lines = result.text.split('\n');
    let finalLines = [];
    
    // Clean text algorithm
    const isFootnoteLine = (line) => {
        if (/^\d{1,3}\)\s/.test(line)) return true;
        if (/\d{1,2}\)\s[\u05D0-\u05EA]/.test(line)) return true;
        if (/ובכ"מ/.test(line)) return true;
        return false;
    };

    for (let rawLine of lines) {
       let line = fixHebrew(rawLine.trim());
       line = reverseHebrewLine(line); // Visual to Logical
       
       if (!line) { finalLines.push(''); continue; }
       if (/^\d{1,4}$/.test(line)) continue; // page numbers
       if (isFootnoteLine(line)) continue;
       
       // Remove inline footnote markers
       line = line.replace(/(?<=[\u05D0-\u05EA'"\u05F3\u05F4,.])\s*\d{1,2}(?=[ ,\.\u05D0-\u05EA'"\u05F3\u05F4\(]|$)/g, '');
       line = line.replace(/(?<!\S)\d{1,2}(?!\S)/g, '');
       line = line.replace(/\s{2,}/g, ' ').trim();
       
       if (line.length < 2) continue;
       finalLines.push(line);
    }
    
    let textOut = finalLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    fs.writeFileSync('extracted_article.txt', textOut, 'utf8');
    console.log('Saved to extracted_article.txt');
  } catch (err) {
    console.error(err);
  }
}
run();
