import { DeltaShadow, EndpointState, ErrorHolder, toLocalEndpoint } from "@vestibule-link/iot-types";
import { DirectiveHandlers } from "../directive";
import channelController from './ChannelController';
import playbackStateReporter from './PlaybackStateReporter';
import powerController from './PowerController';
import recordController from './RecordController';
import { providersEmitter } from "@vestibule-link/bridge-assistant";
import * as _ from 'lodash';
import { AlexaEndpointEmitter } from "endpoint";

export type EndpointStateHandlers = Partial<{
    [NS in keyof EndpointState]: {
        'handleState': (dh: DirectiveHandlers, desiredState: EndpointState[NS]) => Promise<void>
    }
}>

const stateHandlers: EndpointStateHandlers = {};
stateHandlers['Alexa.ChannelController'] = channelController;
stateHandlers['Alexa.PlaybackStateReporter'] = playbackStateReporter;
stateHandlers['Alexa.PowerController'] = powerController;
stateHandlers['Alexa.RecordController'] = recordController;

export function routeStateDelta(thingName: string, shadowObject: DeltaShadow): void {
    const endpoints = shadowObject.state.endpoints;
    _.map(endpoints, (endpoint, endpointId) => {
        const endpointEmitter = <AlexaEndpointEmitter>providersEmitter.getEndpointEmitter('alexa', toLocalEndpoint(endpointId));
        _.map(endpoint, (desiredState, stateId) => {
            const stateHandler = stateHandlers[stateId];
            if (!stateHandler) {
                const error: ErrorHolder = {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'INVALID_DIRECTIVE',
                        message: 'State Handler Not Found'
                    }
                }
                throw error
            }

            const dhs = endpointEmitter.directiveHandlers;
            stateHandler.handleState(dhs, desiredState)
                .catch(err => {
                    //TODO handle error
                    console.log('routeStateDelta %o', err);
                });

        })
    })
}