import { isTrenchConnectorViable } from './trench-connector.ts';
import type { TrenchEndpoint } from './trench-connector.ts';

type Ends = { start: TrenchEndpoint; end: TrenchEndpoint };

/** A shared seam changes both tangents atomically, never either socket position. */
export function resolveTrenchSharedRotation(source: Ends, role: 'start' | 'end', rotation: number,
    partner: Ends, partnerRole: 'start' | 'end', tangentInPartner: { x: number; y: number }) {
    const angle = Math.atan2(tangentInPartner.y, tangentInPartner.x) + (role === partnerRole ? Math.PI : 0);
    const endpoint = { ...source[role], rotation };
    const partnerEndpoint = { ...partner[partnerRole], rotation: Math.atan2(Math.sin(angle), Math.cos(angle)) };
    const viable = (ends: Ends, endRole: 'start' | 'end', value: TrenchEndpoint) =>
        isTrenchConnectorViable(endRole === 'start' ? value : ends.start, endRole === 'end' ? value : ends.end);
    if (!viable(source, role, endpoint) || !viable(partner, partnerRole, partnerEndpoint)) return null;
    return { endpoint, partnerEndpoint };
}
