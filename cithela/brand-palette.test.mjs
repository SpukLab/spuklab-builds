import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
const match=html.match(/<style>([\s\S]*?)<\/style>/);
assert.ok(match,"CSS stylesheet must exist");
const css=match[1];
const first=html.indexOf("const CITHELA_BRAND_PALETTES=");
const end=html.indexOf("function cithelaBrandLogoUrl(",first);
assert.ok(first>=0&&end>first,"palette implementation present");

const changes=new Map();
const document={documentElement:{style:{
  setProperty(name,value){changes.set(name,value);}
}}};
const theme=new Function("document",html.slice(first,end)+
  "\nreturn {CITHELA_BRAND_PALETTES,CITHELA_BRAND_VARS,cithelaBrandPalette,applyCithelaTheme,cithelaBrandStyle};")(document);
const keyMap=theme.CITHELA_BRAND_VARS;
const hex=/^#[0-9a-f]{6}$/i;
function luminance(rgb){
  const components=[1,3,5].map(i=>parseInt(rgb.slice(i,i+2),16)/255)
    .map(c=>c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4));
  return components[0]*.2126+components[1]*.7152+components[2]*.0722;
}
function contrast(a,b){
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
test("four stable theme ids and legacy plum alias work",()=>{
  assert.deepEqual(Object.keys(theme.CITHELA_BRAND_PALETTES),["sage","ocean","clay","pink"]);
  assert.equal(theme.cithelaBrandPalette("plum"),theme.CITHELA_BRAND_PALETTES.pink);
  assert.equal(theme.cithelaBrandPalette("invalid"),theme.CITHELA_BRAND_PALETTES.sage);
});
test("each theme updates the full surface, typography, stroke and primary palette",()=>{
  const snapshots=[];
  for(const [id,palette] of Object.entries(theme.CITHELA_BRAND_PALETTES)){
    changes.clear();
    theme.applyCithelaTheme(id);
    assert.equal(changes.size,Object.keys(keyMap).length,id);
    for(const [token,property] of Object.entries(keyMap)){
      assert.equal(changes.get(property),palette[token],id+":"+token);
      assert.ok(theme.cithelaBrandStyle(id).includes(property+":"+palette[token]+";"),
        "Tenant-scoped cards must share "+token);
    }
    for(const key of ["bg","ink","ink2","ink3","ink4","accent","dark","light","mid","border","surface"])
      assert.match(palette[key],hex,id+":"+key);
    assert.match(palette.shadow,/^rgba\(/,id);
    assert.ok(contrast(palette.accent,"#ffffff")>=4.5,id+":accent on white");
    assert.ok(contrast(palette.dark,"#ffffff")>=4.5,id+":button on white");
    assert.ok(contrast(palette.ink,palette.bg)>=7,id+":body text contrast");
    assert.ok(contrast(palette.ink2,palette.bg)>=4.5,id+":secondary text contrast");
    assert.ok(contrast(palette.ink3,palette.bg)>=4.5,id+":labels contrast");
    snapshots.push(palette.bg+";"+palette.border+";"+palette.ink);
  }
  assert.equal(new Set(snapshots).size,4,"palette is not just one accent");
});
test("actions, exports, WhatsApp operator buttons and draft text use coordinated tokens",()=>{
  assert.match(css,/\.btn-main\.excel\{background:var\(--teal2\)/);
  assert.match(css,/\.mb\.wa\{background:var\(--teal-light\);border-color:var\(--teal-mid\)/);
  assert.match(css,/--line:1px solid var\(--border-color\)/);
  assert.match(css,/--sh:0 2px 12px var\(--shadow-color\)/);
  assert.match(css,/\.cloud-wa-item\{[^\n]*border:1px solid var\(--border-color\)/);
  assert.match(css,/textarea\.inp\[id\^="cloud-wa-note-"\]\{min-height:112px/);
  assert.match(html,/class="brand-swatch-preview"/);
  assert.match(html,/cithela_tenant_branding_update/);
});
