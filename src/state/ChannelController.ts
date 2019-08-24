import { EndpointStateHandlers } from ".";
import { SubType, EndpointState } from "@vestibule-link/iot-types";
import { DirectiveHandlers } from "../directive";
import { ChannelController } from "@vestibule-link/alexa-video-skill-types";

type StateInterface = ChannelController.NamespaceType
const StateInterfaceName: StateInterface = ChannelController.namespace
class StateHandler implements SubType<EndpointStateHandlers, StateInterface>{
    async handleState(dh: DirectiveHandlers, desiredState: EndpointState[StateInterface]) {
        const handler = dh[StateInterfaceName]
        if (desiredState.channel) {
            await handler.ChangeChannel(<ChannelController.ChangeChannelRequest>desiredState);
        }
    }
}

export default new StateHandler();