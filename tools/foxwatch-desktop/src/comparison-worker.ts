import { compareManifest, pixelDifference } from '../shared/asset-diff';
import { compareManifestSource } from '../shared/source-diff';
self.onmessage = (event: MessageEvent) => {
  try {
    if (event.data.kind === 'manifest') {
      postMessage({ result: compareManifest(event.data.before, event.data.after, event.data.catalogReview === true) });
    } else if (event.data.kind === 'manifest-source') {
      postMessage({ result: compareManifestSource(event.data.before, event.data.after, event.data.comparable === true) });
    } else if (event.data.kind === 'pixels') {
      const result = pixelDifference(event.data.before, event.data.after);
      (self as unknown as Worker).postMessage({ result }, [result.pixels.buffer]);
    } else throw new Error('Unknown comparison operation.');
  } catch (cause) { postMessage({ error: cause instanceof Error ? cause.message : String(cause) }); }
};
