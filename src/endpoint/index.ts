import { AlexaEndpoint, EndpointState, SubType, EndpointInfo, EndpointCapability, ErrorHolder, ResponseMessage, endpointTopicPrefix, RequestMessage } from '@vestibule-link/iot-types';
import { DirectiveHandlers, DirectiveRequest } from '../directive';
import { EndpointEmitter, providersEmitter, Assistant } from '@vestibule-link/bridge-assistant';
import { EventEmitter } from 'events';
import { merge } from 'lodash';
import { iotshadow, mqtt } from 'aws-iot-device-sdk-v2';
import { alexaConfig, createConnection } from '../iot';
import { routeStateDelta } from '../state';

export interface StateEmitter {
    refreshState(deltaId: symbol): void;
}
export interface CapabilityEmitter {
    refreshCapability(deltaId: symbol): void;
}
export interface InfoEmitter {
    refreshInfo(deltaId: symbol): void;
}

export interface AlexaStateEmitter {
    emit<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>): boolean
    on<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, listener: (name: N, value: SubType<SubType<EndpointState, NS>, N>) => void): this
    once<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, listener: (name: N, value: SubType<SubType<EndpointState, NS>, N>) => void): this
    removeListener<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, listener: (name: N, value: SubType<SubType<EndpointState, NS>, N>) => void): this
}

export interface AlexaDirectiveEmitter {
    emit<NS extends keyof DirectiveHandlers, N extends keyof DirectiveHandlers[NS]>(event: NS, name: N, request: SubType<SubType<DirectiveHandlers, NS>, N>): boolean
    on<NS extends keyof DirectiveHandlers, N extends keyof DirectiveHandlers[NS]>(event: NS, listener: (name: N, request: SubType<SubType<DirectiveHandlers, NS>, N>) => void): this
    listenerCount<NS extends keyof DirectiveRequest>(type: NS): number;
}

export interface AlexaEndpointEmitter extends EndpointEmitter<'alexa'> {
    alexaStateEmitter: AlexaStateEmitter;
    readonly endpoint: AlexaEndpoint;
    readonly directiveHandlers: DirectiveHandlers
    subscribeMessages(): Promise<void>
    registerDirectiveHandler<NS extends keyof DirectiveHandlers>(namespace: NS, directiveHandler: SubType<DirectiveHandlers, NS>): void;
    completeDeltaState(deltaId: symbol): Promise<void>;
    completeDeltaSettings(deltaId: symbol): Promise<void>;
    watchDeltaUpdate(promise: Promise<void>, deltaId: symbol): void;
    emit(event: 'refreshState' | 'refreshCapability' | 'refreshInfo', deltaId: symbol): boolean;
    on(event: 'refreshState' | 'refreshCapability' | 'refreshInfo', listener: (deltaId: symbol) => void): this;
    once(event: 'refreshState' | 'refreshCapability' | 'refreshInfo', listener: (deltaId: symbol) => void): this;
    removeListener(event: 'refreshState' | 'refreshCapability' | 'refreshInfo', listener: (deltaId: symbol) => void): this;
    emit(event: 'delta', data: AlexaEndpoint, deltaId: symbol): boolean;
    on(event: 'delta', listener: (data: AlexaEndpoint, deltaId: symbol) => void): this;
    once(event: 'delta', listener: (data: AlexaEndpoint, deltaId: symbol) => void): this;
    removeListener(event: 'delta', listener: (data: AlexaEndpoint, deltaId: symbol) => void): this;
    emit(event: 'info', data: EndpointInfo, deltaId: symbol): boolean;
    on(event: 'info', listener: (data: EndpointInfo, deltaId: symbol) => void): this;
    once(event: 'info', listener: (data: EndpointInfo, deltaId: symbol) => void): this;
    removeListener(event: 'info', listener: (data: EndpointInfo, deltaId: symbol) => void): this;
    emit<NS extends keyof EndpointCapability>(event: 'capability', namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol): boolean;
    on<NS extends keyof EndpointCapability>(event: 'capability', listener: (namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol) => void): this;
    once<NS extends keyof EndpointCapability>(event: 'capability', listener: (namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol) => void): this;
    removeListener<NS extends keyof EndpointCapability>(event: 'capability', listener: (namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol) => void): this;
    emit<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: 'state', namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol): boolean;
    on<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: 'state', listener: (namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol) => void): this;
    once<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: 'state', listener: (namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol) => void): this;
    removeListener<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: 'state', listener: (namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol) => void): this;
    emit(event: 'settings', data: EndpointSettings): boolean
    on(event: 'settings', listener: (data: EndpointSettings) => void): this
    once(event: 'settings', listener: (data: EndpointSettings) => void): this
    removeListener(event: 'settings', listener: (data: EndpointSettings) => void): this
}

type EndpointSettings =
    EndpointCapability
    & Partial<Pick<EndpointInfo, Exclude<keyof EndpointInfo, 'endpointId'>>>
class AlexaEndpointEmitterNotifier extends EventEmitter implements AlexaEndpointEmitter {
    readonly alexaStateEmitter: AlexaStateEmitter = new EventEmitter();
    readonly alexaDirectiveEmitter: AlexaDirectiveEmitter = new EventEmitter();
    readonly endpoint: AlexaEndpoint = {};
    private remoteState: AlexaEndpoint = {};
    private readonly deltaPromises = new Map<symbol, Promise<void>[]>();
    private readonly deltaEndpointsState = new Map<symbol, AlexaEndpoint>();
    private readonly deltaEndpointSettings = new Map<symbol, EndpointSettings>();
    private readonly shadowClient: iotshadow.IotShadowClient;
    private readonly settingsTopic: string;
    private readonly namedShadowRequest: NamedShadowRequest
    readonly directiveHandlers: DirectiveHandlers = {};
    private readonly decoder = new TextDecoder('utf8');
    constructor(readonly endpointId: string, readonly mqttConnection: mqtt.MqttClientConnection) {
        super();
        const appConfig = alexaConfig()
        this.shadowClient = new iotshadow.IotShadowClient(mqttConnection);
        this.namedShadowRequest = {
            shadowName: endpointId,
            thingName: appConfig.clientId
        }

        this.settingsTopic = this.topicPrefix + 'settings'

        this.on('info', this.updateInfo);
        this.on('capability', this.updateCapability);
        this.on('state', this.updateState);
        this.on('settings', this.publishSettings.bind(this));
        this.on('delta', this.publishReportedState.bind(this));

        this.setMaxListeners(20)
    }

    private get topicPrefix() {
        return endpointTopicPrefix(this.namedShadowRequest.thingName, 'alexa', this.endpointId)
    }

    private verifyMqttSubscription(req: mqtt.MqttSubscribeRequest) {
        if (req.error_code) {
            const message = `Failed to subscibe to topic ${req.topic} error code ${req.error_code}`
            console.error(message)
            throw new Error(message)
        }
    }
    async subscribeMessages() {
        const directiveTopic = this.topicPrefix + 'directive/#'
        const directive = await this.mqttConnection.subscribe(directiveTopic, mqtt.QoS.AtLeastOnce, this.directiveHandler.bind(this))
        this.verifyMqttSubscription(directive)

        const shadowDelta = await this.shadowClient.subscribeToNamedShadowDeltaUpdatedEvents(this.namedShadowRequest,
            mqtt.QoS.AtLeastOnce, this.shadowDeltaHandler.bind(this))
        this.verifyMqttSubscription(shadowDelta)

        const shadowUpdate = await this.shadowClient.subscribeToNamedShadowUpdatedEvents(this.namedShadowRequest,
            mqtt.QoS.AtLeastOnce, this.shadowUpdateHandler.bind(this))
        this.verifyMqttSubscription(shadowUpdate)

        const shadowGet = await this.shadowClient.subscribeToGetNamedShadowAccepted(this.namedShadowRequest,
            mqtt.QoS.AtLeastOnce, this.shadowGetHandler.bind(this))
        this.verifyMqttSubscription(shadowGet)

        const shadowGetError = await this.shadowClient.subscribeToGetNamedShadowRejected(this.namedShadowRequest,
            mqtt.QoS.AtLeastOnce, this.shadowErrorHandler.bind(this))
        this.verifyMqttSubscription(shadowGetError)

        const shadowUpdateError = await this.shadowClient.subscribeToUpdateNamedShadowRejected(this.namedShadowRequest,
            mqtt.QoS.AtLeastOnce, this.shadowErrorHandler.bind(this))
        this.verifyMqttSubscription(shadowUpdateError)

        const shadowGetRequest = await this.shadowClient.publishGetNamedShadow(this.namedShadowRequest, mqtt.QoS.AtLeastOnce)
    }

    registerDirectiveHandler<NS extends keyof DirectiveHandlers>(namespace: NS, directiveHandler: SubType<DirectiveHandlers, NS>): void {
        this.directiveHandlers[namespace] = directiveHandler;
    }
    watchDeltaUpdate(promise: Promise<void>, deltaId: symbol) {
        let transPromises = this.deltaPromises.get(deltaId);
        if (!transPromises) {
            transPromises = [];
            this.deltaPromises.set(deltaId, transPromises);
        }
        transPromises.push(promise
            .catch((err) => {
                console.log(err)
            }));
    }
    private getDeltaEndpoint(deltaId: symbol) {
        let deltaEndpoint = this.deltaEndpointsState.get(deltaId);
        if (!deltaEndpoint) {
            deltaEndpoint = {};
            this.deltaEndpointsState.set(deltaId, deltaEndpoint);
        }
        return deltaEndpoint;
    }
    private getDeltaSettings(deltaId: symbol) {
        let deltaEndpoint = this.deltaEndpointSettings.get(deltaId);
        if (!deltaEndpoint) {
            deltaEndpoint = {

            };
            this.deltaEndpointSettings.set(deltaId, deltaEndpoint);
        }
        return deltaEndpoint;
    }
    private updateInfo(data: EndpointInfo, deltaId: symbol) {
        merge(this.getDeltaSettings(deltaId), data);
    }
    private updateCapability<NS extends keyof EndpointCapability>(namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol) {
        this.getDeltaSettings(deltaId)[namespace] = value;
    }
    private updateState<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol) {
        this.mergeState(namespace, name, value, this.endpoint);
        this.mergeState(namespace, name, value, this.getDeltaEndpoint(deltaId));
        this.alexaStateEmitter.emit(namespace, name, value);
    }
    private mergeState<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, endpoint: AlexaEndpoint) {
        let nsValue = endpoint[namespace];
        if (!nsValue) {
            nsValue = {};
            endpoint[namespace] = nsValue;
        }
        nsValue[name] = value;
    }
    async refresh(deltaId: symbol): Promise<void> {
        this.emit('refreshState', deltaId);
        this.emit('refreshInfo', deltaId);
        this.emit('refreshCapability', deltaId);
        await this.completeDeltaState(deltaId);
        await this.completeDeltaSettings(deltaId);
    }

    private async waitDeltaPromises(deltaId: symbol) {
        const promises = this.deltaPromises.get(deltaId);
        if (promises) {
            await Promise.all(promises);
            this.deltaPromises.delete(deltaId);
        }
    }
    async completeDeltaState(deltaId: symbol) {
        await this.waitDeltaPromises(deltaId);
        this.emit('delta', this.deltaEndpointsState.get(deltaId), deltaId);
        this.deltaEndpointsState.delete(deltaId);
    }
    async completeDeltaSettings(deltaId: symbol) {
        await this.waitDeltaPromises(deltaId);
        this.emit('settings', this.deltaEndpointSettings.get(deltaId));
        this.deltaEndpointSettings.delete(deltaId);
    }

    private async publishSettings(settings: EndpointSettings) {
        await this.mqttConnection.publish(this.settingsTopic, settings, mqtt.QoS.AtLeastOnce)
    }

    private publishReportedState(state: AlexaEndpoint) {
        this.shadowClient.publishUpdateNamedShadow({
            ...this.namedShadowRequest, ...{
                state: {
                    reported: state
                }
            }
        }, mqtt.QoS.AtLeastOnce)
    }

    private async directiveHandler(topic: string, payload: ArrayBuffer) {
        const start = Date.now()
        const parts = topic.split('/');
        const [root, clientId, assistant, endpoint, endpointId, command, ...directiveArgs] = [...parts];
        const json = this.decoder.decode(payload)
        const req: RequestMessage<any> = JSON.parse(json)
        let resp: ResponseMessage<any>
        try {
            resp = await this.delegateDirective(directiveArgs, req.payload)
        } catch (err) {
            let errorHolder: ErrorHolder
            if (err.errorType) {
                errorHolder = err
            } else {
                errorHolder = {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'INTERNAL_ERROR',
                        message: err.message
                    }
                }
            }
            resp = {
                error: true,
                payload: errorHolder
            }
        }
        this.sendResponse(req, resp, start)
    }

    private async shadowDeltaHandler(error?: iotshadow.IotShadowError, response?: iotshadow.model.ShadowDeltaUpdatedEvent) {
        this.handleShadowError('Delta', error)
        if (response) {
            try {
                await routeStateDelta(response.state, this.directiveHandlers)
            } catch (err) {
                console.log("error %o", err)
            }
        }
    }

    private handleShadowError(errorType: string, error?: iotshadow.IotShadowError) {
        if (error) {
            console.log("%s error %o", errorType, error)
        }
    }
    private shadowUpdateHandler(error?: iotshadow.IotShadowError, response?: iotshadow.model.ShadowUpdatedEvent) {
        this.handleShadowError('Update', error)
        if (response) {
            this.remoteState = response.current.state.reported
        }
    }
    private async shadowGetHandler(error?: iotshadow.IotShadowError, response?: iotshadow.model.GetShadowResponse) {
        this.handleShadowError('Get', error)
        if (response) {
            this.remoteState = response.state.reported

            if (response.state.desired) {
                await routeStateDelta(response.state.desired, this.directiveHandlers)
            }
        }
    }
    private shadowErrorHandler(error?: iotshadow.IotShadowError, response?: iotshadow.model.ErrorResponse) {
        this.handleShadowError('Shadow Error', error)
        if (response) {
            console.error('Shadow error %o', response)
        }
    }

    private sendResponse(req: RequestMessage<any>, resp: ResponseMessage<any>, startTime: number): void {
        const reqTimes = req.responseTime;
        let replyTopic: string | undefined = undefined;
        if (reqTimes && req.replyTopic.async) {
            const responseTime = Date.now() - startTime;
            if (responseTime < reqTimes.maxAllowed) {
                if (responseTime < reqTimes.deferred) {
                    replyTopic = req.replyTopic.sync;
                } else {
                    replyTopic = req.replyTopic.async;
                }
            } else {
                console.log('Not Sending Response, processing time %i', responseTime);
            }
        } else {
            replyTopic = req.replyTopic.sync;
        }
        if (replyTopic) {
            this.mqttConnection.publish(replyTopic, resp, mqtt.QoS.AtLeastOnce, false)
        }
    }
    private async delegateDirective<NS extends keyof DirectiveHandlers, N extends keyof DirectiveHandlers[NS]>(commandArgs: string[], request: any): Promise<ResponseMessage<any>> {
        const [namespaceValue, nameValue] = [...commandArgs];
        const namespace = <NS>namespaceValue;
        const name = <N>nameValue;
        const directiveHandler = this.directiveHandlers[namespace];
        if (directiveHandler) {
            const supported: string[] = directiveHandler.supported;
            if (supported.indexOf(nameValue) >= 0) {
                const handleFunction = <Function><unknown>directiveHandler[name];
                const respPayload = await handleFunction.bind(directiveHandler)(request);
                const resp: ResponseMessage<any> = {
                    payload: respPayload.payload,
                    stateChange: respPayload.state,
                    error: false
                }
                this.alexaDirectiveEmitter.emit(namespace, name, request);
                return resp
            } else {
                const error: ErrorHolder = {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                        message: `Not supported command: ${namespace}:${nameValue}`
                    }
                }
                throw error
            }
        } else {
            const error: ErrorHolder = {
                errorType: 'Alexa',
                errorPayload: {
                    type: 'INVALID_DIRECTIVE',
                    message: `Directive Handler Not Found: ${namespace}`
                }
            }
            throw error
        }
    }
}

class AlexaAssistant implements Assistant<'alexa'>{
    readonly name = 'alexa'
    constructor(readonly mqttConnection: mqtt.MqttClientConnection) {

    }
    async createEndpointEmitter(endpointId: string): Promise<AlexaEndpointEmitter> {
        const ret = new AlexaEndpointEmitterNotifier(endpointId, this.mqttConnection);
        await ret.subscribeMessages();
        return ret;
    }
}

export async function registerAssistant() {
    const connection = await createConnection();
    providersEmitter.registerAssistant(new AlexaAssistant(connection));
}


export interface NamedShadowRequest {
    shadowName: string;
    thingName: string;
}
