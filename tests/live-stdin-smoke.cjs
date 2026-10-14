const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
try {
const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto((process.env.TEST_URL || 'http://localhost:8000'));
await page.waitForFunction(()=>crossOriginIsolated,null,{timeout:30000});
await page.waitForSelector('.cm-content');
console.log('PASS crossOriginIsolated',await page.evaluate(()=>typeof SharedArrayBuffer));
const ready=()=>page.waitForFunction(()=>!document.querySelector('#run-button').disabled,null,{timeout:300000});
const done=()=>page.waitForFunction(()=>document.querySelector('#stop-button').disabled,null,{timeout:120000});
const contains=text=>page.waitForFunction(text=>document.querySelector('#terminal-output').textContent.includes(text),text,{timeout:120000});
const edit=code=>page.locator('.cm-content').fill(code);
const stdin=page.locator('#stdin-input');
for(const lang of ['python','cpp']){
await page.locator('.tab-select').filter({hasText:lang==='cpp'?'main.cpp':'main.py'}).click();await ready();
await edit(lang==='cpp'?'#include <iostream>\n#include <string>\nint main(){std::string s;int n;std::cout<<"NAME: ";std::getline(std::cin,s);std::cout<<"NUMBER: ";std::cin>>n;std::cout<<"RESULT="<<s<<":"<<n<<std::endl;std::cin>>s;std::cout<<"EOF="<<std::cin.eof()<<std::endl;}':'name=input("NAME: ")\nn=int(input("NUMBER: "))\nprint(f"RESULT={name}:{n}")\ntry: input("EOF: ")\nexcept EOFError: print("EOF=1")');
await stdin.fill('');await page.click('#clear-button');await page.click('#run-button');await contains('NAME: ');
assert.equal(await page.locator('#stop-button').isEnabled(),true);
await stdin.fill('Grüße 🌍\n');await contains('NUMBER: ');
await stdin.fill('Grüße 🌍\n42\n');await contains('RESULT=Grüße 🌍:42');
await stdin.press('Control+d');await done();await contains('EOF=1');
console.log('PASS',lang,'prompt then live Unicode getline/input + numeric cin/input, keyboard EOF');
await stdin.fill('');await page.click('#clear-button');await page.click('#run-button');await contains('NAME: ');
await page.click('#stop-button');await ready();await contains('gestoppt');console.log('PASS',lang,'Stop while waiting + worker restart');
await stdin.fill('Prefilled\n7');await page.click('#run-button');await page.click('#stdin-eof');await done();await contains('RESULT=Prefilled:7');console.log('PASS',lang,'prefill + EOF button + unterminated final line');
}
// Exercise ring wrap, main-thread overflow queue, byte deduplication and split surrogates.
await page.locator('.tab-select').filter({hasText:'main.py'}).click();await ready();
await stdin.fill('');await edit('import sys\nprint("READY", flush=True)\ns=sys.stdin.read()\nprint(f"LEN={len(s)} END={s[-2:]}", flush=True)');
await page.click('#clear-button');await page.click('#run-button');await contains('READY');
await stdin.fill('ä'.repeat(100000));
await stdin.evaluate(el=>el.dispatchEvent(new Event('input', {bubbles:true})));
await stdin.evaluate(el=>{el.value+='\uD83C';el.dispatchEvent(new Event('input',{bubbles:true}));el.value+='\uDF0D';el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.click('#stdin-eof');await done();await contains('LEN=100001 END=ä🌍');
console.log('PASS ring wrap/overflow, duplicate input event, split Unicode surrogate');
const fallback=await browser.newContext({serviceWorkers:'block'});const p=await fallback.newPage();await p.goto((process.env.TEST_URL || 'http://localhost:8000'));await p.waitForSelector('.cm-content');assert.equal(await p.evaluate(()=>crossOriginIsolated),false);assert.match(await p.locator('#stdin-note').textContent(),/Fallback/);
await p.waitForFunction(()=>!document.querySelector('#run-button').disabled,null,{timeout:90000});await p.locator('.cm-content').fill('print(input());\ntry: input()\nexcept EOFError: print("FALLBACK EOF")');await p.locator('#stdin-input').fill('Fallback ä');await p.click('#run-button');await p.waitForFunction(()=>document.querySelector('#terminal-output').textContent.includes('FALLBACK EOF'));console.log('PASS actual nonisolated Python prefilled fallback');
await p.locator('.tab-select').filter({hasText:'main.cpp'}).click();await p.waitForFunction(()=>!document.querySelector('#run-button').disabled,null,{timeout:300000});await p.locator('.cm-content').fill('#include <iostream>\n#include <string>\nint main(){std::string s;std::getline(std::cin,s);std::cout<<s;std::getline(std::cin,s);std::cout<<" EOF="<<std::cin.eof();}');await p.click('#run-button');await p.waitForFunction(()=>document.querySelector('#stop-button').disabled,null,{timeout:120000});assert.match(await p.locator('#terminal-output').textContent(),/Fallback ä EOF=1/);console.log('PASS actual nonisolated C++ prefilled fallback');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
