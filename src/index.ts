import { registerModule } from '@vestibule-link/bridge';
import { startModule as assistantStartModule } from '@vestibule-link/bridge-assistant';
import { registerAssistant } from './endpoint';
import { init } from './iot';

export { DirectiveHandlers, SupportedDirectives } from './directive';
export { AlexaDirectiveEmitter, AlexaEndpointEmitter, AlexaStateEmitter, CapabilityEmitter, InfoEmitter, StateEmitter } from './endpoint';

let moduleId: symbol | undefined;

export function startModule() {
    if (!moduleId) {
        moduleId = registerModule({
            name: 'assistant-alexa',
            init: async () => {
                await init();
                registerAssistant();
            },
            depends:[assistantStartModule()]
        })
    }
    return moduleId;
}
