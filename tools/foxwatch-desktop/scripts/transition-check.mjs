import assert from 'node:assert/strict';

// Deliberately slow metadata and file reads so an intermediate blank panel cannot
// slip through the UI smoke test between screenshots.
export async function checkPreviewTransitions(app, page) {
  await app.evaluate(({ ipcMain }) => {
    globalThis.originalAssetHandlers = new Map();
    for (const channel of ['assets:inspect', 'assets:preview']) {
      const original = ipcMain._invokeHandlers.get(channel);
      globalThis.originalAssetHandlers.set(channel, original);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        return original(...args);
      });
    }
  });
  await page.evaluate(() => {
    window.previewTransition = {
      running: true,
      frames: 0,
      flashes: 0,
      blanks: 0,
    };
    const sample = () => {
      const probe = window.previewTransition;
      if (!probe.running) return;
      probe.frames++;
      if (document.querySelector('.empty-inspector')) probe.flashes++;
      const visible = [
        ...document.querySelectorAll(
          '.asset-preview canvas, .asset-preview img, .asset-preview pre',
        ),
      ].some(
        (element) =>
          element.checkVisibility({ visibilityProperty: true }) &&
          (element.tagName !== 'IMG' || element.naturalWidth > 0),
      );
      if (!visible) probe.blanks++;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.previousPreview = document.querySelector('.model-viewport canvas');
  });
  try {
    await page.getByRole('tree').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(90);
    assert.equal(
      await page.evaluate(
        () =>
          window.previousPreview.isConnected &&
          window.previousPreview.checkVisibility({ visibilityProperty: true }),
      ),
      true,
      'keep the rendered model visible while the next file metadata loads',
    );
    await page.waitForFunction(() => {
      const image = document.querySelector('.image-viewport img');
      return (
        image?.checkVisibility({ visibilityProperty: true }) &&
        image.naturalWidth > 0
      );
    });
    await page.evaluate(() => {
      window.previousPreview = document.querySelector('.image-viewport img');
    });
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(90);
    assert.equal(
      await page.evaluate(
        () =>
          window.previousPreview.isConnected &&
          window.previousPreview.checkVisibility({ visibilityProperty: true }),
      ),
      true,
      'keep the image visible while the next model loads',
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('.model-viewport canvas')
          ?.checkVisibility({ visibilityProperty: true }) &&
        !document.querySelector('.model-message'),
    );
    // Pending work for an abandoned selection must never replace the final file.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => {
      const image = document.querySelector('.image-viewport img');
      return (
        image?.checkVisibility({ visibilityProperty: true }) &&
        image.naturalWidth > 0
      );
    });
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator('.file-heading h1').innerText(),
      'hospital.preview.webp',
    );
    const probe = await page.evaluate(() => window.previewTransition);
    assert.ok(probe.frames > 10);
    assert.equal(
      probe.flashes,
      0,
      'never replace the inspector with its opening/empty screen',
    );
    assert.equal(
      probe.blanks,
      0,
      'every painted transition frame retains a ready preview',
    );
  } finally {
    console.log(
      'Preview transition probe:',
      await page.evaluate(() => {
        window.previewTransition.running = false;
        return window.previewTransition;
      }),
    );
    await app.evaluate(({ ipcMain }) => {
      for (const [channel, original] of globalThis.originalAssetHandlers) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, original);
      }
      delete globalThis.originalAssetHandlers;
    });
  }
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(
    () =>
      document
        .querySelector('.model-viewport canvas')
        ?.checkVisibility({ visibilityProperty: true }) &&
      !document.querySelector('.model-message'),
  );
}
