const fs = require('fs');
const pdf = require('pdf-parse');

const fileBuffer = fs.readFileSync('c:/Users/yosef/Downloads/22 מאמר דה מזמור גו\' צמאה לך נפשי, שפ צו, שבת-הגדול, ח\' ניסן (ב).pdf');

pdf(fileBuffer).then(function(data) {
    fs.writeFileSync('output_raw.txt', data.text, 'utf8');
    console.log('Raw output written! length:', data.text.length);
}).catch(err => console.error(err));
