const fs = require('fs');
const pdfjsLib = require('./node_modules/pdfjs-dist/legacy/build/pdf.js');

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
  const data = new Uint8Array(fs.readFileSync('public/sample_doc.pdf'));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  for (let p=1; p<=4; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({scale:1});
    const content = await page.getTextContent();
    let items = content.items.map(i => ({y:Math.round(i.transform[5]), x:i.transform[4], w:i.width, f:Math.abs(i.transform[3]), txt:fixHebrew(i.str)}));
    items = items.filter(i=> i.f >= 11 && i.txt.trim().length > 0);
    items.sort((a,b)=> Math.abs(b.y-a.y)>5 ? b.y-a.y : b.x-a.x);
    
    let lines = [];
    let current = '';
    let lastY = -1000, lastLeft = -1000;
    
    for(const i of items){
      if(Math.abs(i.y - lastY) > 5) {
        if(current) lines.push({txt: current, y: lastY});
        current = i.txt;
      } else {
        if(lastLeft - (i.x + i.w) > 4) current += ' ';
        current += i.txt;
      }
      lastY = i.y;
      lastLeft = i.x;
    }
    if(current) lines.push({txt: current, y: lastY});
    
    console.log(`\nPAGE ${p} (Height ${Math.round(viewport.height)})`);
    for(let i=0; i<Math.min(3, lines.length); i++){
      console.log(`Line ${i}: Y=${lines[i].y} | Text: ${lines[i].txt.split('').reverse().join('').trim()}`);
    }
  }
}
run();