import { EndpointStateHandlers } from ".";
import { SubType, EndpointState } from "@vestibule-link/iot-types";
import { DirectiveHandlers } from "../directive";
import { PlaybackStateReporter } from "@vestibule-link/alexa-video-skill-types";

type StateInterface = PlaybackStateReporter.NamespaceType
const StateInterfaceName: StateInterface = PlaybackStateReporter.namespace
class StateHandler implements SubType<EndpointStateHandlers, StateInterface>{
    async handleState(dh: DirectiveHandlers, desiredState: EndpointState[StateInterface]) {
        const handler = dh[StateInterfaceName]
        switch (desiredState.playbackState) {
            case 'PLAYING':
                await handler.Play({});
                break;
            case 'PAUSED':
                await handler.Pause({});
                break;
            case 'STOPPED':
                await handler.Stop({});
                break;
        }
    }
}

export default new StateHandler();