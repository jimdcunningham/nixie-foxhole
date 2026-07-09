import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    configurePublishLogging,
    logPublishDetail,
    logPublishSummary,
    logPublishWarn,
} from './publish-log.mjs';

test('publish log helpers prefix lines with timestamps', () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const logged = [];
    const warned = [];

    console.log = (...args) => {
        logged.push(args.join(' '));
    };
    console.warn = (...args) => {
        warned.push(args.join(' '));
    };

    try {
        configurePublishLogging({ verbose: true });
        logPublishSummary('summary message');
        logPublishDetail('detail message');
        logPublishWarn('warn message');
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }

    assert.match(logged[0], /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] summary message$/);
    assert.match(logged[1], /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] detail message$/);
    assert.match(warned[0], /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] warn message$/);
});

test('logPublishDetail stays quiet unless verbose', () => {
    const originalLog = console.log;
    const logged = [];
    console.log = (...args) => {
        logged.push(args.join(' '));
    };

    try {
        configurePublishLogging({ verbose: false });
        logPublishDetail('hidden detail');
        logPublishSummary('visible summary');
    } finally {
        console.log = originalLog;
    }

    assert.equal(logged.length, 1);
    assert.match(logged[0], /visible summary$/);
});
