import { ChannelController } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = ChannelController.NamespaceType
class StateHandler implements EndpointStateHandler<StateInterface, StateInterface>{
    readonly directiveName = ChannelController.namespace
    async handleState(handler: DirectiveHandlers[StateInterface], desiredState: EndpointState[StateInterface], currentState: EndpointState) {
        if (desiredState.channel) {
            await handler.ChangeChannel(<ChannelController.ChangeChannelRequest>desiredState);
        }
    }
}

export default new StateHandler();