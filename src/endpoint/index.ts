import { AlexaEndpoint, EndpointState, SubType, EndpointInfo, EndpointCapability, ErrorHolder, ResponseMessage, endpointTopicPrefix, RequestMessage } from '@vestibule-link/iot-types';
import { DirectiveHandlers, DirectiveRequest } from '../directive';
import { EventEmitter } from 'events';
import { merge } from 'lodash';
import { routeStateDelta } from '../state';
import { IotShadowEndpoint, awsConnection, AbstractIotShadowEndpoint } from '@vestibule-link/bridge-gateway-aws';
import { mqtt } from 'aws-iot-device-sdk-v2';
import { serviceProviderManager, ServiceProviderEndpointFactory } from '@vestibule-link/bridge-service-provider'

declare module '@vestibule-link/bridge-service-provider/dist/providers' {
    export interface ServiceProviderConnectors {
        alexa: AlexaEndpointConnector
    }
}
/**
 * Implement to support refresh State.
 * Listen for refrehState event
 */
export interface StateEmitter {
    refreshState(deltaId: symbol): void;
}
/**
 * Implement to support refresh Capability.
 * Listen for refreshCapability event
 */
export interface CapabilityEmitter {
    refreshCapability(deltaId: symbol): void;
}
/**
 * Implement to support refresh Info.
 * Listen for refreshInfo event
 */
export interface InfoEmitter {
    refreshInfo(deltaId: symbol): void;
}

/**
 * Emits state change events
 */
export interface AlexaStateEmitter {
    emit<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>): boolean
    on<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, listener: (name: N, value: SubType<SubType<EndpointState, NS>, N>) => void): this
    once<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, listener: (name: N, value: SubType<SubType<EndpointState, NS>, N>) => void): this
    removeListener<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(event: NS, listener: (name: N, value: SubType<SubType<EndpointState, NS>, N>) => void): this
}

/**
 * Endpoint connector for alexa using aws iot
 */
export interface AlexaEndpointConnector extends IotShadowEndpoint<AlexaEndpoint>, StateEmitter, InfoEmitter, CapabilityEmitter {
    /**
     * DirectiveHandlers supported by this endpoint
     */
    readonly directiveHandlers: DirectiveHandlers
    /**
     * State emitter 
     */
    alexaStateEmitter: AlexaStateEmitter
    /**
     * Listens for refresh events
     * @param listener listener to emit messages
     */
    listenRefreshEvents(listener: InfoEmitter | StateEmitter | CapabilityEmitter): void
    /**
     * Registers a directive handler for this endpoint
     * Automatically attaches the any listeners for refresh events
     * @param namespace directive namespace
     * @param directiveHandler directive handler for namespace
     */
    registerDirectiveHandler<NS extends keyof DirectiveHandlers>(namespace: NS, directiveHandler: SubType<DirectiveHandlers, NS>): void;
    /**
     * Indicates all changes have been sent
     * Connector should update the endpoint settings based on deltaId
     * @param deltaId change id
     */
    completeDeltaSettings(deltaId: symbol): Promise<void>;
    /**
     * Update info
     * @param data endpoint info
     * @param deltaId change id
     */
    updateInfo(data: EndpointInfo, deltaId: symbol): void
    /**
     * Update a capability for a namespace
     * @param namespace capability namespace
     * @param value capability value
     * @param deltaId change id
     */
    updateCapability<NS extends keyof EndpointCapability>(namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol): void
    /**
     * Update state for a namespace/name
     * @param namespace state namespace
     * @param name state name
     * @param value state value
     * @param deltaId change id
     */
    updateState<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol): void
}

type EndpointSettings =
    EndpointCapability
    & Partial<Pick<EndpointInfo, Exclude<keyof EndpointInfo, 'endpointId'>>>
class AlexaEndpointConnectorImpl extends AbstractIotShadowEndpoint<EndpointState> implements AlexaEndpointConnector {
    readonly alexaStateEmitter: AlexaStateEmitter = new EventEmitter();
    private readonly deltaEndpointSettings = new Map<symbol, EndpointSettings>();
    private readonly settingsTopic: string;
    readonly directiveHandlers: DirectiveHandlers = {};
    private readonly decoder = new TextDecoder('utf8');
    constructor(endpointId: string) {
        super(endpointId);

        this.settingsTopic = this.topicPrefix + 'settings'

        this.setMaxListeners(20)
    }
    refreshState(deltaId: symbol): void {
        this.emit('refreshState', deltaId)
    }
    refreshInfo(deltaId: symbol): void {
        this.emit('refreshInfo', deltaId)
    }
    refreshCapability(deltaId: symbol): void {
        this.emit('refreshCapability', deltaId)
    }

    private get topicPrefix() {
        return endpointTopicPrefix(this.namedShadowRequest.thingName, 'alexa', this.endpointId)
    }

    async subscribeMessages() {
        await super.subscribeMessages()
        const directiveTopic = this.topicPrefix + 'directive/#'
        const directive = await awsConnection().subscribe(directiveTopic, mqtt.QoS.AtMostOnce, this.directiveHandler.bind(this))
        this.verifyMqttSubscription(directive)
    }

    public listenRefreshEvents(listener: InfoEmitter | StateEmitter | CapabilityEmitter) {
        ['refreshState', 'refreshCapability', 'refreshInfo'].forEach((value => {
            if (listener[value]) {
                this.on(value, listener[value].bind(listener))
            }
        }))
    }

    registerDirectiveHandler<NS extends keyof DirectiveHandlers>(namespace: NS, directiveHandler: SubType<DirectiveHandlers, NS>): void {
        this.directiveHandlers[namespace] = directiveHandler;
        if (directiveHandler['refreshState'] || directiveHandler['refreshCapability'] || directiveHandler['refreshInfo']) {
            this.listenRefreshEvents(<any>directiveHandler)
        }
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
    public updateInfo(data: EndpointInfo, deltaId: symbol) {
        merge(this.getDeltaSettings(deltaId), data);
    }
    public updateCapability<NS extends keyof EndpointCapability>(namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol) {
        this.getDeltaSettings(deltaId)[namespace] = value;
    }
    public updateState<NS extends keyof EndpointState, N extends keyof EndpointState[NS]>(namespace: NS, name: N, value: SubType<SubType<EndpointState, NS>, N>, deltaId: symbol) {
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
        this.refreshState(deltaId);
        this.refreshInfo(deltaId);
        this.refreshCapability(deltaId);
        await this.completeDeltaState(deltaId);
        await this.completeDeltaSettings(deltaId);
    }

    async completeDeltaSettings(deltaId: symbol) {
        await this.waitDeltaPromises(deltaId);
        await this.publishSettings(this.deltaEndpointSettings.get(deltaId));
        this.deltaEndpointSettings.delete(deltaId);
    }

    private async publishSettings(settings?: EndpointSettings) {
        if (settings) {
            await awsConnection().publish(this.settingsTopic, settings, mqtt.QoS.AtMostOnce)
        }
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

    protected async handleDeltaState(state: EndpointState): Promise<void> {
        await routeStateDelta(state, this.directiveHandlers, this.reportedState)
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
            awsConnection().publish(replyTopic, resp, mqtt.QoS.AtMostOnce, false)
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

class AlexaAssistant implements ServiceProviderEndpointFactory<'alexa'>{
    readonly name = 'alexa'
    constructor() {

    }
    async createEndpointConnector(endpointId: string): Promise<AlexaEndpointConnectorImpl> {
        const ret = new AlexaEndpointConnectorImpl(endpointId);
        await ret.subscribeMessages();
        return ret;
    }
}

export async function registerAssistant() {
    serviceProviderManager.registerServiceProvider(new AlexaAssistant());
}

