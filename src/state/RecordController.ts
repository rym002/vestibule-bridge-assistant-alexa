import { EndpointStateHandlers } from ".";
import { SubType, EndpointState } from "@vestibule-link/iot-types";
import { DirectiveHandlers } from "../directive";
import { RecordController } from "@vestibule-link/alexa-video-skill-types";

type StateInterface = RecordController.NamespaceType
const StateInterfaceName: StateInterface = RecordController.namespace
class StateHandler implements SubType<EndpointStateHandlers, StateInterface>{
    async handleState(dh: DirectiveHandlers, desiredState: EndpointState[StateInterface]) {
        const handler = dh[StateInterfaceName]
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