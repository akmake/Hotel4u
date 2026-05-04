const fs = require('fs');

const str = \???? ?? ‰‡?ˆ\;
// Let's decode this.
// Each character from the PDF is probably a unicode char that corresponds to MacRoman or Latin1.
// Let's print out the char codes.
for (let i=0; i<str.length; i++) {
  console.log(str[i], str.charCodeAt(i).toString(16));
}
