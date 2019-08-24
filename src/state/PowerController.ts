import { EndpointStateHandlers } from ".";
import { SubType, EndpointState } from "@vestibule-link/iot-types";
import { DirectiveHandlers } from "../directive";
import { PowerController } from "@vestibule-link/alexa-video-skill-types";

type StateInterface = PowerController.NamespaceType
const StateInterfaceName: StateInterface = PowerController.namespace
class StateHandler implements SubType<EndpointStateHandlers, StateInterface>{
    async handleState(dh: DirectiveHandlers, desiredState: EndpointState[StateInterface]) {
        const handler = dh[StateInterfaceName]
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