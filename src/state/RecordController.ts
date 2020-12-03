import { RecordController } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = RecordController.NamespaceType
class StateHandler implements EndpointStateHandler<StateInterface, StateInterface>{
    directiveName = RecordController.namespace
    async handleState(handler: DirectiveHandlers[StateInterface], desiredState: EndpointState[StateInterface]) {
        switch (desiredState.RecordingState) {
            case 'NOT_RECORDING':
                await handler.StopRecording({});
                break;
            case 'RECORDING':
                await handler.StartRecording({});
                break;
        }
    }
}

export default new StateHandler();