import { computed } from 'vue';

const FOXHOLE_INSPECTOR_CODENAME_BUILDER_STATE_KEY = 'foxhole-inspector-codename-builder';

export function normalizeFoxholeInspectorCodename(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

export function normalizeFoxholeInspectorCodenameList(values: Iterable<unknown>): string[] {
    const normalized = new Set<string>();

    for (const value of values) {
        const codename = normalizeFoxholeInspectorCodename(value);
        if (codename) {
            normalized.add(codename);
        }
    }

    return Array.from(normalized);
}

export function appendFoxholeInspectorCodename(values: Iterable<unknown>, value: unknown): string[] {
    const normalized = new Set(normalizeFoxholeInspectorCodenameList(values));
    const codename = normalizeFoxholeInspectorCodename(value);

    if (codename) {
        normalized.add(codename);
    }

    return Array.from(normalized);
}

export function buildFoxholeInspectorCodenameString(values: Iterable<unknown>): string {
    return normalizeFoxholeInspectorCodenameList(values).join(',');
}

export function useFoxholeInspectorCodenameBuilder() {
    const state = useState<string[]>(FOXHOLE_INSPECTOR_CODENAME_BUILDER_STATE_KEY, () => []);

    const items = computed(() => normalizeFoxholeInspectorCodenameList(state.value));
    const count = computed(() => items.value.length);
    const hasItems = computed(() => count.value > 0);

    function add(value: unknown): boolean {
        const next = appendFoxholeInspectorCodename(items.value, value);
        if (next.length === items.value.length) {
            return false;
        }

        state.value = next;
        return true;
    }

    function has(value: unknown): boolean {
        const codename = normalizeFoxholeInspectorCodename(value);
        return Boolean(codename) && items.value.includes(codename);
    }

    function reset(): void {
        if (!state.value.length) {
            return;
        }

        state.value = [];
    }

    function buildString(): string {
        return buildFoxholeInspectorCodenameString(items.value);
    }

    return {
        items,
        count,
        hasItems,
        add,
        has,
        reset,
        buildString,
    };
}
