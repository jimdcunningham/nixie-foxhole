<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string> = {
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  chevron: 'm9 6 6 6-6 6',
  folder: 'M3 7V5h6l2 2h10v13H3Z',
  'folder-open': 'M3 7V5h6l2 2h10v3M3 7v13h16l3-10H7L3 20',
  file: 'M14 3H5v18h14V8ZM14 3v6h5',
  model: 'm12 3 9 5-9 5-9-5Zm-9 5v9l9 5 9-5V8M12 13v9',
  image: 'M3 3h18v18H3ZM3 16l6-6 6 6 3-3 3 3M16 7h.01',
  data: 'm8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18',
  audio:
    'M9 18V5l11-2v13M9 8l11-2M9 18c0 3-6 4-6 1s6-4 6-1Zm11-2c0 3-6 4-6 1s6-4 6-1Z',
  refresh:
    'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  collapse: 'M8 3h13v13M3 8h13v13H3Zm4 7h5',
  close: 'm6 6 12 12M6 18 18 6',
};
</script>
<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.file" />
  </svg>
</template>
