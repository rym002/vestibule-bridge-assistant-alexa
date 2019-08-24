import { registerModule, listenInit } from '@vestibule-link/bridge'
import { init } from './iot';
import { registerAssistant } from './endpoint';

export { DirectiveHandlers, SupportedDirectives } from './directive'
export { CapabilityEmitter, InfoEmitter, StateEmitter } from './endpoint'

listenInit('assistant', async () => {
    registerModule({
        name: 'assistant-alexa',
        init: async () => {
            await init();
            registerAssistant();
        }
    })
})