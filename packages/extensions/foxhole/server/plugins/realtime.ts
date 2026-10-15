import {
    isFoxholeRealtimeAutostartEnabled,
    isFoxholeRealtimeLocalEnabled,
} from '../utils/service-config.ts';
import { startFoxholeRealtimeService } from '../utils/runtime.ts';

const foxholeRealtimeAutostartGlobal = globalThis as typeof globalThis & {
    __foxholeRealtimeAutostartPromise__?: Promise<void> | null;
};

export default defineNitroPlugin(async () => {
    if (!isFoxholeRealtimeLocalEnabled()) {
        return;
    }

    if (!isFoxholeRealtimeAutostartEnabled()) {
        return;
    }

    if (foxholeRealtimeAutostartGlobal.__foxholeRealtimeAutostartPromise__) {
        await foxholeRealtimeAutostartGlobal.__foxholeRealtimeAutostartPromise__;
        return;
    }

    foxholeRealtimeAutostartGlobal.__foxholeRealtimeAutostartPromise__ = (async () => {
        await startFoxholeRealtimeService();
        console.info('Foxhole realtime autostart plugin loaded.');
    })();

    try {
        await foxholeRealtimeAutostartGlobal.__foxholeRealtimeAutostartPromise__;
    } finally {
        foxholeRealtimeAutostartGlobal.__foxholeRealtimeAutostartPromise__ = null;
    }
});
