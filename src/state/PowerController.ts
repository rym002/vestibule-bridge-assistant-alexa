import { PowerController } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState, ErrorHolder } from "@vestibule-link/iot-types";
import { EndpointStateHandler } from ".";
import { DirectiveHandlers } from "../directive";

type StateInterface = PowerController.NamespaceType
class StateHandler implements EndpointStateHandler<StateInterface, StateInterface>{
    readonly directiveName = PowerController.namespace
    async handleState(handler: DirectiveHandlers[StateInterface], desiredState: EndpointState[StateInterface], currentState: EndpointState) {
        const desiredOperationState = desiredState.powerState
        const currentOperationState = currentState[PowerController.namespace] ? currentState[PowerController.namespace].powerState : undefined
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
    operation: PowerController.Operations
    expectedCurrentState: PowerController.States[]
}

type StateCommandMap = {
    [K in PowerController.States]: StateCommand
}

const stateCommandMap: StateCommandMap = {
    OFF: {
        expectedCurrentState: ['ON'],
        operation: 'TurnOff'
    },
    ON: {
        expectedCurrentState: ['OFF'],
        operation: 'TurnOn'
    }
}

export default new StateHandler();