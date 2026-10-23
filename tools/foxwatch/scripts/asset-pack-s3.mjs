import {S3Client, HeadObjectCommand, PutObjectCommand} from '@aws-sdk/client-s3';
import {createReadStream} from 'node:fs';

/** Explicit credentials only: never fall through to an unrelated AWS profile. */
export function createAssetPublicationS3(target, env = process.env, options = {}) {
    const accessKeyId = env.FOXWATCH_ASSETS_ACCESS_KEY_ID, secretAccessKey = env.FOXWATCH_ASSETS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) throw new Error('Set FOXWATCH_ASSETS_ACCESS_KEY_ID and FOXWATCH_ASSETS_SECRET_ACCESS_KEY locally before uploading');
    const client = new S3Client({endpoint: target.endpoint, region: 'auto', forcePathStyle: true, maxAttempts: 1,
        requestHandler: {connectionTimeout: 10_000, requestTimeout: 120_000},
        requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', credentials: {accessKeyId, secretAccessKey}, ...options});
    const put = async (row, signal, mutable = false) => {
        const body = createReadStream(row.sourceFile);
        try {
            await client.send(new PutObjectCommand({Bucket: target.bucket, Key: row.key, Body: body, ContentLength: row.bytes,
                ContentType: row.mediaType, ContentEncoding: row.contentEncoding, CacheControl: row.cacheControl, IfNoneMatch: mutable ? undefined : '*', ContentMD5: row.md5,
                Metadata: {'foxwatch-sha256': row.sha256, 'foxwatch-decoded-sha256': row.decodedSha256, 'foxwatch-decoded-bytes': String(row.decodedBytes)},
            }), {abortSignal: signal});
        } finally {body.destroy();}
    };
    return {
        async head(key, signal) {
            try {
                const row = await client.send(new HeadObjectCommand({Bucket: target.bucket, Key: key}), {abortSignal: signal});
                return {sha256: row.Metadata?.['foxwatch-sha256'], bytes: row.ContentLength, mediaType: row.ContentType,
                    contentEncoding: row.ContentEncoding, cacheControl: row.CacheControl,
                    decodedSha256: row.Metadata?.['foxwatch-decoded-sha256'], decodedBytes: Number(row.Metadata?.['foxwatch-decoded-bytes'])};
            } catch (error) {if (error.$metadata?.httpStatusCode === 404) return null; throw error;}
        },
        put: (row, signal) => put(row, signal),
        putChannel(row, signal) {
            if (row.key !== target.prefix + '/channels/stable.json') throw new Error('Only the stable channel may be overwritten');
            return put(row, signal, true);
        },
        close: () => client.destroy(),
    };
}
