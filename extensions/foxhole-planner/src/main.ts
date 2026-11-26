import * as sdk from '@nixiejs/extension-sdk';
import { setPlannerCatalogText } from './runtime-catalog-source.ts';

type PreparedCatalog = Pick<sdk.ConnectNixieExtensionOptions, 'port' | 'identity'> & { catalogText?: string };
const prepare = (sdk as typeof sdk & {
    prepareNixieExtensionCatalog?: (id: string) => Promise<PreparedCatalog>;
}).prepareNixieExtensionCatalog;
const prepared = await prepare?.('foxhole.catalog');
setPlannerCatalogText(prepared?.catalogText);
try {
    const { sceneV2 } = await import('./runtime-systems.ts');
    const connection = await sdk.connectNixieExtension({ port: prepared?.port, identity: prepared?.identity, sceneV2 });
    window.addEventListener('pagehide', () => connection.dispose(), { once: true });
} catch (error) {
    prepared?.port?.close?.();
    throw error;
}
