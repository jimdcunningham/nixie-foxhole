import type { FoxholePlaybackEventRecord } from '#foxhole/composables/useFoxholeWarPanelData.ts';

interface FoxholeMapSubscription {
    request?: object;
    onUpdate: (payload: unknown) => void;
    onOpen: () => void;
}

interface FoxholeEventSubscription {
    shardId: string;
    onEvent: (event: FoxholePlaybackEventRecord) => void;
    onSubscribed: () => void;
}

const sockets = new Map<string, FoxholeRealtimeSocket>();

export function getFoxholeRealtimeSocket(endpoint: string): FoxholeRealtimeSocket {
    let socket = sockets.get(endpoint);
    if (!socket) {
        socket = new FoxholeRealtimeSocket(endpoint);
        sockets.set(endpoint, socket);
    }
    return socket;
}

class FoxholeRealtimeSocket {
    private readonly endpoint: string;
    private readonly maps = new Map<string, FoxholeMapSubscription>();
    private nextMapId = 0;
    private events: FoxholeEventSubscription | null = null;
    private socket: WebSocket | null = null;
    private reconnectTimer: number | null = null;
    private reconnectAttempts = 0;

    constructor(endpoint: string) {
        this.endpoint = endpoint;
    }

    subscribeMaps<TUpdate>(onUpdate: (payload: TUpdate) => void, onOpen: () => void) {
        const subscriptionId = String(++this.nextMapId);
        const subscription: FoxholeMapSubscription = {
            onUpdate: payload => onUpdate(payload as TUpdate),
            onOpen,
        };
        this.maps.set(subscriptionId, subscription);
        if (this.socket?.readyState === WebSocket.OPEN) {
            onOpen();
        }
        this.connect();

        return {
            sendRequest: (request: object) => {
                subscription.request = request;
                this.send('request-maps', request, subscriptionId);
            },
            close: () => {
                if (!this.maps.delete(subscriptionId)) return;
                this.send('unsubscribe-maps', undefined, subscriptionId);
                this.closeIfIdle();
            },
        };
    }

    subscribeEvents(subscription: FoxholeEventSubscription): () => void {
        this.events = subscription;
        this.send('subscribe-events', { shardId: subscription.shardId });
        this.connect();

        return () => {
            if (this.events === subscription) {
                this.events = null;
                this.send('subscribe-events', {});
                this.closeIfIdle();
            }
        };
    }

    private send(type: string, payload?: object, subscriptionId?: string): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type, payload, subscriptionId }));
        }
    }

    private connect(): void {
        if (this.socket || this.reconnectTimer !== null) return;

        const socket = new WebSocket(this.endpoint);
        this.socket = socket;
        socket.addEventListener('open', () => {
            if (this.socket !== socket) return;

            this.reconnectAttempts = 0;
            if (this.events) {
                this.send('subscribe-events', { shardId: this.events.shardId });
            }
            for (const [id, subscription] of this.maps) {
                subscription.onOpen();
                if (subscription.request) {
                    this.send('request-maps', subscription.request, id);
                }
            }
        });

        socket.addEventListener('message', ({ data }) => {
            if (this.socket !== socket) return;

            let envelope: { type: string; subscriptionId?: string; payload?: unknown; };
            try {
                envelope = JSON.parse(String(data));
            } catch {
                return;
            }
            if (!envelope?.payload) return;

            if (envelope.type === 'update-maps') {
                const subscription = envelope.subscriptionId
                    ? this.maps.get(envelope.subscriptionId)
                    // Older map hosts return a response without a subscription ID.
                    : (this.maps.size === 1 ? this.maps.values().next().value : undefined);
                subscription?.onUpdate(envelope.payload);
            } else if (envelope.type === 'playback-event') {
                const event = envelope.payload as FoxholePlaybackEventRecord;
                if (this.events && event.shardId === this.events.shardId && event.id && event.eventType) {
                    this.events.onEvent(event);
                }
            } else if (envelope.type === 'events-subscribed') {
                const { shardId } = envelope.payload as { shardId?: string; };
                if (this.events && shardId === this.events.shardId) {
                    this.events.onSubscribed();
                }
            }
        });

        socket.addEventListener('close', () => {
            if (this.socket !== socket) return;

            this.socket = null;
            const delay = Math.min(60_000, 1000 * 2 ** this.reconnectAttempts++);
            this.reconnectTimer = window.setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, delay * (1 + Math.random() * 0.5));
        });
        socket.addEventListener('error', () => socket.close());
    }

    private closeIfIdle(): void {
        if (this.maps.size || this.events) return;

        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        sockets.delete(this.endpoint);
    }
}
