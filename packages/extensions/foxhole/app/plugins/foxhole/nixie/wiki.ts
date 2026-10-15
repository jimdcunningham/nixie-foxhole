/** Foxhole wiki.gg helpers shared by the inspector card and Nixie assistant tools. */

export const FOXHOLE_WIKI_ORIGIN = 'https://foxhole.wiki.gg';
export const FOXHOLE_WIKI_API_URL = `${FOXHOLE_WIKI_ORIGIN}/api.php`;
export const FOXHOLE_WIKI_USER_AGENT = 'NixieBot/1.0 (https://nixie.app; Foxhole wiki assistant)';

const TIER_SECTION_RE = /\(Tier (\d)\)/;
const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITY_RE = /&(#x?[0-9a-f]+|[a-z]+);/gi;

export type FoxholeWikiSearchHit = {
    title: string;
    pageId: number;
    url: string;
    snippet: string;
    size?: number;
};

export type FoxholeWikiPage = {
    title: string;
    pageId: number;
    url: string;
    extract: string;
    truncated: boolean;
};

export type FoxholeWikiFetch = (
    input: string | URL,
    init?: RequestInit,
) => Promise<Response>;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

/** Decode a few common HTML entities left in MediaWiki search snippets. */
function decodeBasicHtmlEntities(value: string): string {
    return value.replace(HTML_ENTITY_RE, (match, raw: string) => {
        const key = String(raw ?? '').toLowerCase();
        if (key === 'amp') {
            return '&';
        }
        if (key === 'lt') {
            return '<';
        }
        if (key === 'gt') {
            return '>';
        }
        if (key === 'quot') {
            return '"';
        }
        if (key === 'apos' || key === '#39') {
            return '\'';
        }
        if (key === 'nbsp') {
            return ' ';
        }
        if (key.startsWith('#x')) {
            const code = Number.parseInt(key.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (key.startsWith('#')) {
            const code = Number.parseInt(key.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return match;
    });
}

/** Strip MediaWiki highlight markup from search snippets. */
export function stripFoxholeWikiHtml(value: unknown): string {
    const text = normalizeString(value);
    if (!text) {
        return '';
    }
    return decodeBasicHtmlEntities(text.replace(HTML_TAG_RE, '')).replace(/\s+/g, ' ').trim();
}

/**
 * Build a foxhole.wiki.gg page URL from an asset/display name.
 * Spaces become `_`; `(Tier N)` becomes a `#Tier_N-0` section hash.
 */
export function buildFoxholeWikiPageUrl(pageName: unknown): string {
    const wikiName = normalizeString(pageName);
    if (!wikiName) {
        return '';
    }

    const withTier = wikiName.replace(TIER_SECTION_RE, '\0#Tier_$1-0');
    const [pathPart, hashPart] = withTier.split('\0#');
    const slug = String(pathPart ?? '').trim().replaceAll(' ', '_');
    if (!slug) {
        return '';
    }

    const url = `${FOXHOLE_WIKI_ORIGIN}/wiki/${slug}`;
    return hashPart ? `${url}#${hashPart}` : url;
}

/** Normalize a page title or wiki URL into a MediaWiki titles= value. */
export function normalizeFoxholeWikiPageTitle(value: unknown): string {
    const raw = normalizeString(value);
    if (!raw) {
        return '';
    }

    let title = raw;
    try {
        if (/^https?:\/\//i.test(raw)) {
            const url = new URL(raw);
            const marker = '/wiki/';
            const idx = url.pathname.indexOf(marker);
            if (idx >= 0) {
                title = decodeURIComponent(url.pathname.slice(idx + marker.length));
            }
        }
    } catch {
        // Keep the raw string when URL parsing fails.
    }

    title = title.split('#')[0] ?? title;
    title = title.replaceAll('_', ' ').trim();
    return title;
}

function buildApiUrl(params: Record<string, string>): string {
    const url = new URL(FOXHOLE_WIKI_API_URL);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

async function fetchWikiJson(
    params: Record<string, string>,
    fetchImpl: FoxholeWikiFetch,
): Promise<Record<string, unknown>> {
    const response = await fetchImpl(buildApiUrl(params), {
        headers: {
            'accept': 'application/json',
            'user-agent': FOXHOLE_WIKI_USER_AGENT,
        },
    });
    if (!response.ok) {
        throw new Error(`foxhole wiki request failed (${response.status})`);
    }
    return asRecord(await response.json());
}

export async function searchFoxholeWiki(options: {
    query: string;
    limit?: number;
    fetchImpl?: FoxholeWikiFetch;
}): Promise<{
    query: string;
    totalHits: number;
    results: FoxholeWikiSearchHit[];
    searchUrl: string;
}> {
    const query = normalizeString(options.query);
    if (!query) {
        throw new Error('query is required');
    }

    const limit = Math.max(1, Math.min(10, Math.floor(options.limit ?? 5)));
    const fetchImpl = options.fetchImpl ?? fetch;
    const payload = await fetchWikiJson({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: String(limit),
        srprop: 'snippet|titlesnippet|size',
        format: 'json',
    }, fetchImpl);

    const queryRecord = asRecord(payload.query);
    const searchInfo = asRecord(queryRecord.searchinfo);
    const hits = Array.isArray(queryRecord.search) ? queryRecord.search : [];
    const results: FoxholeWikiSearchHit[] = [];

    for (const entry of hits) {
        const record = asRecord(entry);
        const title = normalizeString(record.title);
        if (!title) {
            continue;
        }
        const pageId = typeof record.pageid === 'number' ? record.pageid : Number(record.pageid);
        results.push({
            title,
            pageId: Number.isFinite(pageId) ? pageId : 0,
            url: buildFoxholeWikiPageUrl(title),
            snippet: stripFoxholeWikiHtml(record.snippet) || stripFoxholeWikiHtml(record.titlesnippet),
            ...(typeof record.size === 'number' ? { size: record.size } : {}),
        });
    }

    const totalHitsRaw = searchInfo.totalhits;
    const totalHits = typeof totalHitsRaw === 'number'
        ? totalHitsRaw
        : Number(totalHitsRaw);

    return {
        query,
        totalHits: Number.isFinite(totalHits) ? totalHits : results.length,
        results,
        searchUrl: `${FOXHOLE_WIKI_ORIGIN}/wiki/Special:Search?search=${encodeURIComponent(query)}`,
    };
}

export async function readFoxholeWikiPage(options: {
    title: string;
    maxChars?: number;
    fetchImpl?: FoxholeWikiFetch;
}): Promise<FoxholeWikiPage> {
    const title = normalizeFoxholeWikiPageTitle(options.title);
    if (!title) {
        throw new Error('title is required');
    }

    const maxChars = Math.max(500, Math.min(12_000, Math.floor(options.maxChars ?? 6_000)));
    const fetchImpl = options.fetchImpl ?? fetch;
    const payload = await fetchWikiJson({
        action: 'query',
        prop: 'extracts',
        explaintext: '1',
        redirects: '1',
        titles: title,
        format: 'json',
    }, fetchImpl);

    const queryRecord = asRecord(payload.query);
    const pages = asRecord(queryRecord.pages);
    const pageEntries = Object.values(pages);
    const page = asRecord(pageEntries[0]);
    if (!page || page.missing !== undefined) {
        throw new Error(`wiki page not found: ${title}`);
    }

    const resolvedTitle = normalizeString(page.title) || title;
    const pageId = typeof page.pageid === 'number' ? page.pageid : Number(page.pageid);
    const extractRaw = normalizeString(page.extract);
    const truncated = extractRaw.length > maxChars;
    const extract = truncated ? `${extractRaw.slice(0, maxChars).trimEnd()}…` : extractRaw;

    return {
        title: resolvedTitle,
        pageId: Number.isFinite(pageId) ? pageId : 0,
        url: buildFoxholeWikiPageUrl(resolvedTitle),
        extract,
        truncated,
    };
}
