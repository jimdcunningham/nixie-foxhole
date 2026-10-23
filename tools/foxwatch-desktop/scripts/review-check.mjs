import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
export async function checkAssetReview(app, page, root) {
  await writeFile(path.join(root, 'modified.txt'), 'before');
  await page
    .getByRole('button', { name: 'Refresh Assets', exact: true })
    .click();
  await page
    .getByRole('treeitem', { name: 'modified.txt', exact: true })
    .waitFor();
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((item) => item.label === '&Review')
      .submenu.items.find(
        (item) => item.label === 'Approve Current Assets as Baseline',
      )
      .click(),
  );
  await page.getByText('0 Changes', { exact: true }).waitFor();
  await writeFile(path.join(root, 'modified.txt'), 'after!');
  await writeFile(path.join(root, 'added.txt'), 'new asset');
  await unlink(path.join(root, 'second.glb')); // Only a disposable smoke fixture.
  await page
    .getByRole('button', { name: 'Refresh Assets', exact: true })
    .click();
  await page.getByText('3 Changes', { exact: true }).waitFor();
  assert.equal(await page.locator('.change-badge.added').count(), 1);
  assert.equal(await page.locator('.change-badge.modified').count(), 1);
  assert.equal(await page.locator('.change-badge.deleted').count(), 1);
  await page.locator('[id="entry-second.glb"]').click();
  await page
    .getByText('Deleted from working files · Showing the approved version', {
      exact: true,
    })
    .waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('.asset-preview')?.getAttribute('aria-busy') ===
      'false',
  );
  const details = await page.evaluate(async () => {
    const r = await window.foxwatch.getRoot();
    return window.foxwatch.inspect(r.id, 'second.glb');
  });
  assert.equal(details.fromBaseline, true);
  assert.ok((await readFile(details.absolutePath)).length > 100);
  await page.getByRole('button', { name: 'Changes Only', exact: true }).click();
  assert.equal(await page.getByRole('treeitem').count(), 3);
  const summary = await page.evaluate(async () => {
    const r = await window.foxwatch.getRoot();
    return window.foxwatch.review(r.id, 'summary');
  });
  assert.deepEqual(
    [summary.added, summary.modified, summary.deleted],
    [1, 1, 1],
  );
  await app.evaluate(({dialog}) => {
    globalThis.discardDialogs = []; globalThis.discardChoice = 0;
    globalThis.originalReviewDialog = dialog.showMessageBox;
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      if (options.title !== 'Return to Baseline') return globalThis.originalReviewDialog(...args);
      globalThis.discardDialogs.push(options);
      return {response:globalThis.discardChoice,checkboxChecked:false};
    };
  });
  const discard = page.getByRole('button',{name:'Return to Baseline…',exact:true});
  await discard.click();
  while (await app.evaluate(()=>globalThis.discardDialogs.length) < 1) await page.waitForTimeout(25);
  await page.waitForFunction(()=>!document.querySelector('.discard-controls button').disabled);
  assert.equal(await readFile(path.join(root,'modified.txt'),'utf8'),'after!');
  assert.equal(await readFile(path.join(root,'added.txt'),'utf8'),'new asset');
  await assert.rejects(readFile(path.join(root,'second.glb')),{code:'ENOENT'});
  const prompt = await app.evaluate(()=>globalThis.discardDialogs[0]);
  assert.equal(prompt.defaultId,0); assert.equal(prompt.cancelId,0);
  assert.deepEqual(prompt.buttons,['Cancel','Return to Baseline']);
  assert.ok(prompt.detail.includes(root));
  assert.match(prompt.detail,/Restore 2 files/); assert.match(prompt.detail,/Remove 1 added files/);
  await app.evaluate(()=>globalThis.discardChoice=1);
  await discard.click();
  await page.getByText('0 Changes',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.discard-controls button').disabled);
  assert.equal(await readFile(path.join(root,'modified.txt'),'utf8'),'before');
  assert.ok((await readFile(path.join(root,'second.glb'))).length>100);
  await assert.rejects(readFile(path.join(root,'added.txt')),{code:'ENOENT'});
  assert.equal(await page.getByRole('button',{name:'Changes Only',exact:true}).getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('.change-badge').count(),0);
  const restoredSummary = await page.evaluate(async()=>{const root=await window.foxwatch.getRoot();return window.foxwatch.review(root.id,'summary');});
  assert.equal(restoredSummary.approvedAt,summary.approvedAt);
  await app.evaluate(({dialog})=>dialog.showMessageBox=globalThis.originalReviewDialog);

}
