import { PlaybackController, PlaybackStateReporter } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState, ErrorHolder } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = PlaybackStateReporter.NamespaceType
type DirectiveInterface = PlaybackController.NamespaceType
class StateHandler implements EndpointStateHandler<DirectiveInterface, StateInterface>{
    readonly directiveName = PlaybackController.namespace
    async handleState(handler: DirectiveHandlers[DirectiveInterface], desiredState: EndpointState[StateInterface], currentState: EndpointState) {
        const desiredOperationState = desiredState.playbackState.state
        const currentOperationState = currentState[PlaybackStateReporter.namespace] ? currentState[PlaybackStateReporter.namespace].playbackState.state : undefined
        const stateCommand = stateCommandMap[desiredOperationState]
        if (stateCommand.expectedCurrentState.includes(currentOperationState)) {
            if (handler.supported.includes(stateCommand.operation)) {
                await handler[stateCommand.operation]({})
            } else {
                const error: ErrorHolder = {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                        message: `Directive Handler ${this.directiveName} does not support Operation ${stateCommand.operation}`
                    }
                }
                throw error
            }
        } else {
            console.log(`Invalid state transition from: ${currentOperationState} to: ${desiredOperationState}`)
        }
    }
}
interface StateCommand {
    operation: PlaybackController.Operations
    expectedCurrentState: PlaybackStateReporter.States[]
}

type StateCommandMap = {
    [K in PlaybackStateReporter.States]: StateCommand
}

const stateCommandMap: StateCommandMap = {
    PLAYING: {
        expectedCurrentState: ['PAUSED'],
        operation: 'Play'
    },
    PAUSED: {
        expectedCurrentState: ['PLAYING'],
        operation: 'Pause'
    },
    STOPPED: {
        expectedCurrentState: ['PAUSED', 'PLAYING'],
        operation: 'Stop'
    }
}

export default new StateHandler();