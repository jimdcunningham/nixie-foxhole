import { defineWebSocketHandler } from 'h3';
import { isFoxholeRealtimeLocalEnabled } from '#foxhole-server/utils/service-config.ts';
import {
    handleFoxholeRealtimeMessage,
    registerFoxholeConnection,
    startFoxholeRealtimeService,
    unregisterFoxholeConnection,
} from '#foxhole-server/utils/runtime.ts';

export default defineWebSocketHandler({
    async open(peer) {
        if (!isFoxholeRealtimeLocalEnabled()) {
            peer.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Foxhole realtime is disabled on this host.' },
            }));
            (peer as { close?: () => void; }).close?.();
            return;
        }

        await startFoxholeRealtimeService();
        registerFoxholeConnection(peer as { send(data: string): void; });
    },
    message(peer, message) {
        handleFoxholeRealtimeMessage(peer as { send(data: string): void; }, message.text());
    },
    close(peer) {
        unregisterFoxholeConnection(peer as { send(data: string): void; });
    },
});
