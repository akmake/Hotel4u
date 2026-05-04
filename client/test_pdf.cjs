const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const hebrewMap = {
  0xe0:'א',0x2021:'א',0xe1:'ב',0x00B7:'ב',0xe2:'ג',0x201A:'ג',0xe3:'ד',0x201E:'ד',0xe4:'ה',0x2030:'ה',
  0xe5:'ו',0x00C2:'ו',0xe6:'ז',0x00CA:'ז',0xe7:'ח',0x00C1:'ח',0xe8:'ט',0x00CB:'ט',0xe9:'י',0x00C8:'י',0xC8:'י',
  0xea:'ך',0x00CD:'ך',0xCD:'ך',0xeb:'כ',0x00CE:'כ',0xec:'ל',0x00CF:'ל',0xCF:'ל',0xed:'ם',0x00CC:'ם',
  0xee:'מ',0x00D3:'מ',0xD3:'מ',0xef:'ן',0x00D4:'ן',0xf0:'נ',0xF8FF:'נ',0xf1:'ס',0x00D2:'ס',0xf2:'ע',
  0x00DA:'ע',0xf3:'ף',0x00DB:'ף',0xf4:'פ',0x00D9:'פ',0xD9:'פ',0xf5:'ץ',0x0131:'ץ',0xf6:'צ',0x02C6:'צ',
  0xf7:'ק',0x02DC:'ק',0xf8:'ר',0x00AF:'ר',0xf9:'ש',0x02D8:'ש',0xfa:'ת',0x02D9:'ת'
};

function fixHebrew(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out += hebrewMap[code] || str[i];
  }
  return out;
}

async function run() {
  const data = new Uint8Array(fs.readFileSync('client/public/sample_doc.pdf'));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  
  let items = content.items.map(item => ({
    y: Math.round(item.transform[5]),
    x: item.transform[4],
    w: item.width,
    str: item.str,
    fixedText: fixHebrew(item.str),
    fontSize: Math.abs(item.transform[3])
  }));
  
  items.sort((a,b) => {
    if (Math.abs(b.y - a.y) > 5) return b.y - a.y;
    return b.x - a.x; // right to left
  });
  
  let currentLine = '';
  let lastY = -1000;
  let lastLeft = -1000;
  
  let lines = [];
  
  for (const item of items) {
    if (item.fontSize < 11) continue;
    
    if (Math.abs(item.y - lastY) > 5) {
       if (currentLine.length > 0) lines.push(currentLine);
       currentLine = item.fixedText;
    } else {
       let gap = lastLeft - (item.x + item.w);
       if (gap > 4) currentLine += ' ';
       currentLine += item.fixedText;
    }
    lastY = item.y;
    lastLeft = item.x;
  }
  if (currentLine) lines.push(currentLine);
  
  for(let i=0; i<30; i++) {
     console.log("LINE:", lines[i]);
  }
}
run();