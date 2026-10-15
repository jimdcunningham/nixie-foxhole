import { defineNuxtPlugin } from '#app';
import { registerFoxholeHostProductProfile } from '#foxhole/utils/host-product-profile.ts';
export default defineNuxtPlugin({ name: 'foxhole-host-product-profile', enforce: 'pre', setup: registerFoxholeHostProductProfile });
