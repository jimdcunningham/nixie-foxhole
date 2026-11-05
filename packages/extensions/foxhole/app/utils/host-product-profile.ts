import { registerNixieAcquisitionSource } from '#nixie/utils/nixie-studio-activation.ts';
import { registerNixieReservedPublicUsernames } from '#nixie/utils/nixie-public-username.ts';
export function registerFoxholeHostProductProfile(): void {
    registerNixieAcquisitionSource({ id: 'foxhole', matches: value => /foxhole/i.test(value), paths: { '/foxhole-planner': 'foxhole-planner' } });
    registerNixieReservedPublicUsernames(['foxhole', 'foxholeplanner', 'foxwatch']);
}
