import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import FoxholeChatMapReferenceSegment from '#foxhole/components/nixie/chat/FoxholeChatMapReferenceSegment.vue';
import {
    FOXHOLE_CHAT_MAP_GRID_RENDERER_ID,
    FOXHOLE_CHAT_MAP_GRID_SEGMENT_PARSER,
} from '#foxhole/plugins/foxhole/nixie/chat/map-grid.ts';

export default defineContribution({
    chatParsers: [
        FOXHOLE_CHAT_MAP_GRID_SEGMENT_PARSER,
    ],
    chatRenderers: [
        {
            id: FOXHOLE_CHAT_MAP_GRID_RENDERER_ID,
            component: FoxholeChatMapReferenceSegment,
        },
    ],
});
