import { PowerController } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = PowerController.NamespaceType
class StateHandler implements EndpointStateHandler<StateInterface, StateInterface>{
    readonly directiveName = PowerController.namespace
    async handleState(handler: DirectiveHandlers[StateInterface], desiredState: EndpointState[StateInterface]) {
        switch (desiredState.powerState) {
            case 'OFF':
                await handler.TurnOff({});
                break;
            case 'ON':
                await handler.TurnOn({});
                break;
        }
    }
}

export default new StateHandler();