import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = p => readFileSync(new URL(p,import.meta.url),"utf8");
const appIcon=read("./brand/cithela-favicon.svg");
const adminIcon=read("./brand/admin-favicon.svg");

test("CITHELA keeps the approved two-band C on both icons, with distinct admin blue",()=>{
  for (const svg of [appIcon,adminIcon]){
    assert.equal((svg.match(/<path /g)||[]).length,2);
    assert.match(svg,/M12 57C12 32 32 15 60 15H93/);
    assert.match(svg,/M12 57C14 78 31 90 58 90H92/);
    assert.doesNotMatch(svg,/<script\b/i);
  }
  assert.match(appIcon,/#81C7B9/i);
  assert.match(adminIcon,/#B8F0FF/i);
  assert.match(adminIcon,/#112C49/i);
  assert.notEqual(appIcon,adminIcon);
});

test("professional and admin routes use separate SVG, pinned-tab and iOS home-screen images",()=>{
  const routes = [
    ["index.html",false],["alta-profesional.html",false],["alta-whatsapp.html",false],
    ["comercial-admin.html",true],["invitar-profesionales.html",true]
  ];
  for (const [file,admin] of routes){
    const page=read("./"+file);
    assert.match(page,new RegExp("href=\\\"\\./brand/"+(admin?"admin":"cithela")+"-favicon\\.svg"));
    assert.match(page,new RegExp("href=\\\"\\./brand/"+(admin?"admin":"cithela")+"-mask\\.svg"));
    assert.match(page,new RegExp("href=\\\"\\./brand/"+(admin?"admin":"cithela")+"-touch-180\\.png"));
  }
  for (const asset of ["cithela","admin"]){
    const png=readFileSync(new URL("./brand/"+asset+"-touch-180.png",import.meta.url));
    assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16),180);
    assert.equal(png.readUInt32BE(20),180);
  }
});
