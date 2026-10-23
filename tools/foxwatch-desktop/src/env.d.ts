import type { InspectorApi } from '../shared/contracts';
declare global {
  interface Window {
    foxwatch: InspectorApi;
  }
}
