import { registerFoxholeProductionAssistantProvider } from '#foxhole-server/utils/register-production-assistant.ts';

export default defineNitroPlugin(() => {
    registerFoxholeProductionAssistantProvider();
});
