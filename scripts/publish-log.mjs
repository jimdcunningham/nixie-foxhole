let publishVerbose = false;

export function configurePublishLogging({ verbose = false } = {}) {
    publishVerbose = Boolean(verbose);
}

export function isPublishVerbose() {
    return publishVerbose;
}

export function logPublishDetail(message) {
    if (publishVerbose) {
        console.log(message);
    }
}

export function logPublishSummary(message) {
    console.log(message);
}
