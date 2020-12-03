import { PlaybackController, PlaybackStateReporter } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = PlaybackStateReporter.NamespaceType
type DirectiveInterface = PlaybackController.NamespaceType
class StateHandler implements EndpointStateHandler<DirectiveInterface, StateInterface>{
    readonly directiveName = PlaybackController.namespace
    async handleState(handler: DirectiveHandlers[DirectiveInterface], desiredState: EndpointState[StateInterface]) {
        switch (desiredState.playbackState.state) {
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