const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {chromium}=require('C:/Users/yosef dahan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage(); const faults=[];page.on('pageerror',e=>faults.push(e.message));
 const url='file:///'+path.join(__dirname,'index.html').replace(/\\/g,'/');
 const checks=[];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(url);
  checks.push(await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,screens:[...document.querySelectorAll('h3[id]')].filter(h=>h.id.includes('-')).length,tables:document.querySelectorAll('table').length,sections:document.querySelectorAll('section').length})));
  await page.screenshot({path:path.join(__dirname,`reading-${width}.png`),fullPage:false});
  await page.locator('#search').fill('FIN-06');
  if(await page.locator('#results a').count()!==1)faults.push('Search result mismatch '+width);
  await page.locator('#results a').click();
  if(!page.url().endsWith('#FIN-06'))faults.push('Search navigation mismatch '+width);
  await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});
  await page.locator('#FIN-06').scrollIntoViewIfNeeded();
  const y=await page.locator('#FIN-06').evaluate(el=>el.getBoundingClientRect().top);
  if(y<0||y>1000)faults.push('Target not visible '+width);
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(url+'#FD-03');
 await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});
 await page.locator('#FD-03').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(__dirname,'reading-screen.png'),fullPage:false});
 await browser.close();
 const report={checks,faults,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'index.html'))).digest('hex'),pass:!faults.length&&checks.every(c=>c.documentWidth<=c.width&&c.screens===99)};
 fs.writeFileSync(path.join(__dirname,'reading-validation.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(!report.pass)process.exit(1);
})();
