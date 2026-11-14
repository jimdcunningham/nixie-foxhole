import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeRealtimeSocket } from '../../app/plugins/foxhole/nixie/map/live-socket.ts';

test('map and war events share a connection and events survive closing the map', () => {
    const opened = [];
    const timers = new Map();
    let nextTimer = 0;

    class TestSocket extends EventTarget {
        static OPEN = 1;
        readyState = 0;
        sent = [];

        constructor() {
            super();
            opened.push(this);
        }

        open() {
            this.readyState = TestSocket.OPEN;
            this.dispatchEvent(new Event('open'));
        }

        receive(type, payload, subscriptionId) {
            this.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({ type, payload, subscriptionId }),
            }));
        }

        send(data) {
            this.sent.push(JSON.parse(data));
        }

        close() {
            this.readyState = 3;
            this.dispatchEvent(new Event('close'));
        }
    }

    const originalWindow = globalThis.window;
    const originalSocket = globalThis.WebSocket;
    globalThis.WebSocket = TestSocket;
    globalThis.window = {
        setTimeout(callback) {
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout(id) { timers.delete(id); },
    };

    const connection = getFoxholeRealtimeSocket('ws://foxhole.test/ws/foxhole');
    const events = [];
    const maps = [];
    let acknowledgments = 0;
    const releaseEvents = connection.subscribeEvents({
        shardId: 'live',
        onEvent: event => events.push(event.id),
        onSubscribed: () => acknowledgments++,
    });
    const map = connection.subscribeMaps(update => maps.push(update), () => {});
    map.sendRequest({ shardId: 'live', realtime: true });

    try {
        assert.equal(opened.length, 1);
        const [socket] = opened;
        socket.open();
        assert.deepEqual(socket.sent.map(message => message.type), ['subscribe-events', 'request-maps']);
        const mapId = socket.sent[1].subscriptionId;
        socket.receive('update-maps', { warNumber: 141 }, mapId);
        socket.receive('events-subscribed', { shardId: 'live' });
        assert.deepEqual(maps, [{ warNumber: 141 }]);

        map.close();
        assert.equal(socket.readyState, TestSocket.OPEN);
        assert.equal(socket.sent.at(-1).type, 'unsubscribe-maps');
        socket.receive('playback-event', { id: 'other-shard', eventType: 'town-captured', shardId: 'other' });
        socket.receive('playback-event', { id: 'a', eventType: 'town-captured', shardId: 'live' });

        socket.close();
        assert.equal(timers.size, 1);
        const [reconnect] = timers.values();
        timers.clear();
        reconnect();
        const reconnected = opened[1];
        reconnected.open();
        assert.deepEqual(reconnected.sent, [{ type: 'subscribe-events', payload: { shardId: 'live' } }]);
        reconnected.receive('events-subscribed', { shardId: 'live' });
        reconnected.receive('playback-event', { id: 'b', eventType: 'rocket-impact', shardId: 'live' });
        assert.deepEqual(events, ['a', 'b']);
        assert.equal(acknowledgments, 2);
        releaseEvents();
        assert.equal(reconnected.readyState, 3);
        assert.equal(timers.size, 0);
    } finally {
        map.close();
        releaseEvents();
        globalThis.WebSocket = originalSocket;
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
