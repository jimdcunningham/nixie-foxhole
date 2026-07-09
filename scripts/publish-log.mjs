let publishVerbose = false;

export function configurePublishLogging({ verbose = false } = {}) {
    publishVerbose = Boolean(verbose);
}

export function isPublishVerbose() {
    return publishVerbose;
}

function formatPublishLogTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function formatPublishLogLine(message) {
    return `[${formatPublishLogTimestamp()}] ${message}`;
}

export function logPublishDetail(message) {
    if (publishVerbose) {
        console.log(formatPublishLogLine(message));
    }
}

export function logPublishSummary(message) {
    console.log(formatPublishLogLine(message));
}

export function logPublishWarn(message) {
    console.warn(formatPublishLogLine(message));
}
