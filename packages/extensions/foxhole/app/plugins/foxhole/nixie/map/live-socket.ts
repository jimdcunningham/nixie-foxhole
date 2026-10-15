interface FoxholeRealtimeSocketOptions<TUpdate> {
    endpoint: string;
    onUpdate: (data: TUpdate) => void;
    onOpen?: () => void;
}

interface FoxholeRealtimeEnvelope<TPayload> {
    type?: string;
    payload?: TPayload;
}

export class FoxholeRealtimeSocket<TRequest, TUpdate> {
    private readonly endpoint: string;
    private readonly onUpdate: (data: TUpdate) => void;
    private readonly onOpen?: () => void;
    private socket: WebSocket | null = null;
    private reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
    private reconnectAttempts = 0;
    private closed = false;
    private pendingRequest: string | null = null;

    constructor(options: FoxholeRealtimeSocketOptions<TUpdate>) {
        this.endpoint = options.endpoint;
        this.onUpdate = options.onUpdate;
        this.onOpen = options.onOpen;
    }

    get connected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    connect(): void {
        this.closed = false;
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const socket = new WebSocket(this.endpoint);
        this.socket = socket;

        socket.addEventListener('open', () => {
            if (this.socket !== socket) {
                return;
            }

            this.reconnectAttempts = 0;
            this.onOpen?.();
            if (this.pendingRequest) {
                socket.send(this.pendingRequest);
            }
        });

        socket.addEventListener('message', event => {
            let envelope: FoxholeRealtimeEnvelope<TUpdate>;
            try {
                envelope = JSON.parse(String(event.data)) as FoxholeRealtimeEnvelope<TUpdate>;
            } catch {
                return;
            }

            if (envelope.type === 'update-maps' && envelope.payload) {
                this.onUpdate(envelope.payload);
            }
        });

        socket.addEventListener('close', () => {
            if (this.socket === socket) {
                this.socket = null;
            }
            if (!this.closed) {
                this.scheduleReconnect();
            }
        });

        socket.addEventListener('error', () => {
            socket.close();
        });
    }

    sendRequest(request: TRequest): void {
        this.pendingRequest = JSON.stringify({
            type: 'request-maps',
            payload: request,
        });

        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(this.pendingRequest);
        }
    }

    close(): void {
        this.closed = true;
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.socket?.close();
        this.socket = null;
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) {
            return;
        }

        const baseDelay = Math.min(60000, Math.pow(2, this.reconnectAttempts) * 1000);
        const jitter = baseDelay * (Math.random() * 0.5);
        this.reconnectAttempts += 1;
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, baseDelay + jitter);
    }
}
