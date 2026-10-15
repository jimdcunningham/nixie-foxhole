/** Share one fresh input snapshot between declarations and resources in each watched build. */
export function createResourceBuildSnapshot<T>(load: () => Promise<T>) {
    let current: Promise<T> | undefined;
    return {
        begin: () => current = load(),
        read: () => current ??= load(),
    };
}
