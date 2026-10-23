import test from 'node:test';
import assert from 'node:assert/strict';
import { compareManifest, pixelDifference, unionBounds } from '../shared/asset-diff.ts';

test('manifest fields ignore object key order and distinguish null, missing, and changed values', () => {
  const diff = compareManifest('{"same":{"a":1,"b":2},"remove":null,"change":1}', '{"same":{"b":2,"a":1},"change":2,"add":null}');
  assert.deepEqual(diff.changes.map(row => [row.kind,row.path,row.before,row.after]), [
    ['removed','/remove','null',null], ['changed','/change','1','2'], ['added','/add',null,'null'],
  ]);
});
test('named arrays preserve identity across insertions but report meaningful reorderings', () => {
  const a = JSON.stringify({ items: [{id:'a',v:1},{id:'b',v:2}] });
  const b = JSON.stringify({ items: [{id:'new',v:0},{id:'b',v:3},{id:'a',v:1}] });
  const diff = compareManifest(a,b);
  assert.deepEqual(diff.changes.map(row => row.path), ['/items/(order)', '/items/[id=b]/v', '/items/[id=new]']);
});
test('manifest comparisons handle missing files, primitives, escaping, and bounded results', () => {
  assert.equal(compareManifest(null,'{"x":1}').changes[0]?.kind,'added');
  assert.equal(compareManifest('false',null).changes[0]?.kind,'removed');
  assert.equal(compareManifest('{"a/b~":1}','{"a/b~":2}').changes[0]?.path,'/a~1b~0');
  const large = Object.fromEntries(Array.from({length:4000},(_,i) => [i,i]));
  const result = compareManifest(JSON.stringify(large), JSON.stringify(Object.fromEntries(Object.keys(large).map(key => [key,-1]))));
  assert.equal(result.changes.length,3000); assert.equal(result.limited,true);
  assert.throws(() => compareManifest('invalid','{}'));
});
test('pixel differences detect opacity and color changes without opaque transparent-RGB noise', () => {
  const a = new Uint8ClampedArray([255,0,0,0, 255,255,255,255, 40,40,40,255]);
  const b = new Uint8ClampedArray([0,255,0,0, 255,255,255,128, 40,40,40,255]);
  const result = pixelDifference(a,b);
  assert.equal(result.changed,1); assert.equal(result.total,3);
  assert.equal(result.pixels[0],0); assert.equal(result.pixels[3],0);
  assert.deepEqual([...result.pixels.slice(4,7)],[255,78,161]);
  assert.throws(() => pixelDifference(a,new Uint8ClampedArray(4)));
});
test('model framing keeps both versions in original world units and includes origin changes', () => {
  assert.deepEqual(unionBounds([{min:{x:-1,y:0,z:-2},max:{x:1,y:2,z:2}}, {min:{x:10,y:-5,z:-1},max:{x:20,y:1,z:3}}]),
    {min:{x:-1,y:-5,z:-2},max:{x:20,y:2,z:3}});
});
