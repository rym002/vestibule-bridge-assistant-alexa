import { Directive } from "@vestibule-link/alexa-video-skill-types";
import { EndpointState, ErrorHolder, SubType } from "@vestibule-link/iot-types";
import { map } from 'lodash';
import { DirectiveHandlers } from "../directive";
import channelController from './ChannelController';
import playbackStateReporter from './PlaybackStateReporter';
import powerController from './PowerController';
import recordController from './RecordController';



export interface EndpointStateHandler<DT extends Directive.Namespaces, ST extends keyof EndpointState> {
    readonly directiveName: DT
    handleState: (handler: SubType<DirectiveHandlers, DT>, desiredState: EndpointState[ST], currentState: EndpointState) => Promise<void>
}

type EndpointStateHandlers = {
    [NS in keyof EndpointState]: EndpointStateHandler<any, NS>
}
const stateHandlers: EndpointStateHandlers = {
    'Alexa.ChannelController': channelController,
    'Alexa.PlaybackStateReporter': playbackStateReporter,
    'Alexa.PowerController': powerController,
    'Alexa.RecordController': recordController
}
export async function routeStateDelta(endpointDesiredState: EndpointState, directiveHandlers: DirectiveHandlers, currentState: EndpointState): Promise<void> {
    const promises = map(endpointDesiredState, async (desiredState, stateId: keyof EndpointState) => {
        const stateHandler = stateHandlers[stateId];        
        if (stateHandler) {
            const directiveHandler = directiveHandlers[stateHandler.directiveName]
            if (directiveHandler) {
                await stateHandler.handleState(directiveHandler, desiredState, currentState)
            } else {
                const error: ErrorHolder = {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                        message: `Directive Handler Not found: ${stateHandler.directiveName}`
                    }
                }
                throw error
            }
        } else {
            const error: ErrorHolder = {
                errorType: 'Alexa',
                errorPayload: {
                    type: 'INVALID_DIRECTIVE',
                    message: 'State Handler Not Found'
                }
            }
            throw error
        }
    })
    await Promise.all(promises)
}