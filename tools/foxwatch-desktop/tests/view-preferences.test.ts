import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectScope } from 'vue';
import { createViewPreferences } from '../src/view-preferences.ts';

test('view choices survive recreating preferences with independent image sliders', () => {
  const saved = new Map<string,string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key,value); } };
  const scope = effectScope();
  const first = scope.run(() => createViewPreferences(storage))!;
  // The first preview closes before later previews change shared preferences.
  scope.stop();
  first.imageMode.value = 'overlay'; first.swipePosition.value = 24; first.overlayOpacity.value = 68;
  first.imageBackground.value = 'dark'; first.modelMode.value = 'before';
  first.manifestMode.value = 'source'; first.manifestFilter.value = 'changed'; first.formattedJson.value = false;
  const restored = createViewPreferences(storage);
  for (const key of Object.keys(first) as Array<keyof typeof first>) assert.equal(restored[key].value,first[key].value,key);
  assert.equal(restored.swipePosition.value,24); assert.equal(restored.overlayOpacity.value,68);
});

test('invalid saved choices use defaults and slider values stay within their bounds', () => {
  const preferences = createViewPreferences({ getItem: key => ({
    'foxwatch.imageCompareMode': 'unknown', 'foxwatch.imageBackground': 'invalid',
    'foxwatch.modelCompareMode': 'side', 'foxwatch.manifestCompareMode': 'broken',
    'foxwatch.manifestChangeType': 'missing', 'foxwatch.swipePosition': '-20', 'foxwatch.overlayOpacity': '200',
  } as Record<string,string>)[key] ?? null, setItem() {} });
  assert.equal(preferences.imageMode.value,'side'); assert.equal(preferences.imageBackground.value,'checker');
  assert.equal(preferences.modelMode.value,'both'); assert.equal(preferences.manifestMode.value,'fields'); assert.equal(preferences.manifestFilter.value,'all');
  assert.equal(preferences.swipePosition.value,0); assert.equal(preferences.overlayOpacity.value,100);
  for (const invalid of ['NaN','Infinity','', ' ']) assert.equal(createViewPreferences({getItem: () => invalid,setItem() {}}).swipePosition.value,50);
});

test('storage errors keep inspection usable and session preferences writable', () => {
  const preferences = createViewPreferences({getItem() {throw new Error('unavailable');},setItem() {throw new Error('full');}});
  assert.equal(preferences.imageMode.value,'side');
  assert.doesNotThrow(() => {preferences.imageMode.value = 'swipe';});
  assert.equal(preferences.imageMode.value,'swipe');
});
