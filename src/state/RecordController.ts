import { PlaybackStateReporter, RecordController } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState, ErrorHolder } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = RecordController.NamespaceType
class StateHandler implements EndpointStateHandler<StateInterface, StateInterface>{
    directiveName = RecordController.namespace
    async handleState(handler: DirectiveHandlers[StateInterface], desiredState: EndpointState[StateInterface], currentState: EndpointState) {
        const desiredOperationState = desiredState.RecordingState
        const currentOperationState = currentState[RecordController.namespace] ? currentState[RecordController.namespace].RecordingState : undefined
        const stateCommand = stateCommandMap[desiredOperationState]
        if (stateCommand.expectedCurrentState.includes(currentOperationState)) {
            if (handler.supported.includes(stateCommand.operation)) {
                const currentPlaybackState = currentState[PlaybackStateReporter.namespace] ? currentState[PlaybackStateReporter.namespace].playbackState.state : undefined
                if (stateCommand.expectedCurrentPlaybackState.includes(currentPlaybackState)){
                    await handler[stateCommand.operation]({})
                }else{
                    const error: ErrorHolder = {
                        errorType: 'Alexa',
                        errorPayload: {
                            type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                            message: `Directive Handler ${this.directiveName} ${PlaybackStateReporter.namespace}:${currentPlaybackState} expected ${stateCommand.expectedCurrentPlaybackState}`
                        }
                    }
                    throw error    
                }
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
    operation: RecordController.Operations
    expectedCurrentState: RecordController.States[]
    expectedCurrentPlaybackState: PlaybackStateReporter.States[]
}

type StateCommandMap = {
    [K in RecordController.States]: StateCommand
}

const stateCommandMap: StateCommandMap = {
    NOT_RECORDING: {
        expectedCurrentState: ['RECORDING'],
        operation: 'StopRecording',
        expectedCurrentPlaybackState: ['PAUSED', 'PLAYING', 'STOPPED']
    },
    RECORDING: {
        expectedCurrentState: ['NOT_RECORDING'],
        operation: 'StartRecording',
        expectedCurrentPlaybackState: ['PAUSED', 'PLAYING']
    }
}

export default new StateHandler();