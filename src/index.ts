import { registerModule } from '@vestibule-link/bridge';
import { startModule as serviceProviderStartModule } from '@vestibule-link/bridge-service-provider';
import { startModule as awsGatewayStartModule } from '@vestibule-link/bridge-gateway-aws';
import { registerAssistant } from './endpoint';

export { DirectiveHandlers, SupportedDirectives } from './directive';
export { AlexaEndpointConnector, AlexaStateEmitter, CapabilityEmitter, InfoEmitter, StateEmitter } from './endpoint';

let moduleId: symbol | undefined;

export function startModule() {
    if (!moduleId) {
        moduleId = registerModule({
            name: 'assistant-alexa',
            init: async () => {
                await registerAssistant();
            },
            depends: [serviceProviderStartModule(),
            awsGatewayStartModule()]
        })
    }
    return moduleId;
}
