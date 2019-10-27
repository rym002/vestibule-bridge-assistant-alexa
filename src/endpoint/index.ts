import { AlexaEndpoint, EndpointState, SubType, EndpointInfo, EndpointCapability, ErrorHolder, ResponseMessage, LocalEndpoint, generateEndpointId } from '@vestibule-link/iot-types';
import { DirectiveHandlers, DirectiveRequest } from '../directive';
import { CommandType, responseRouter, EndpointEmitter, providersEmitter, Assistant } from '@vestibule-link/bridge-assistant';
import { EventEmitter } from 'events';
import * as _ from 'lodash';

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
    emit(event: CommandType, commandArgs: string[], request: any, messageId: symbol): boolean;
    on(event: CommandType, listener: (commandArgs: string[], request: any, messageId: symbol) => void): this;
    once(event: CommandType, listener: (commandArgs: string[], request: any, messageId: symbol) => void): this;
    removeListener(event: CommandType, listener: (commandArgs: string[], request: any, messageId: symbol) => void): this;
    emit(event: 'settings', data: EndpointSettings): boolean
    on(event: 'settings', listener: (data: EndpointSettings) => void): this
    once(event: 'settings', listener: (data: EndpointSettings) => void): this
    removeListener(event: 'settings', listener: (data: EndpointSettings) => void): this
}

type EndpointSettings = 
    EndpointCapability
    & Partial<Pick<EndpointInfo,Exclude<keyof EndpointInfo,'endpointId'>>>
class AlexaEndpointEmitterNotifier extends EventEmitter implements AlexaEndpointEmitter {
    readonly alexaStateEmitter: AlexaStateEmitter = new EventEmitter();
    readonly alexaDirectiveEmitter: AlexaDirectiveEmitter = new EventEmitter();
    readonly endpoint: AlexaEndpoint = {};
    private readonly deltaPromises = new Map<symbol, Promise<void>[]>();
    private readonly deltaEndpointsState = new Map<symbol, AlexaEndpoint>();
    private readonly deltaEndpointSettings = new Map<symbol, EndpointSettings>();
    readonly directiveHandlers: DirectiveHandlers = {};
    constructor(readonly endpointId: string) {
        super();
        this.on('directive', this.delegateDirective);
        this.on('info', this.updateInfo);
        this.on('capability', this.updateCapability);
        this.on('state', this.updateState);
        this.setMaxListeners(20)
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
        transPromises.push(promise);
    }
    private getDeltaEndpoint(deltaId: symbol) {
        let deltaEndpoint = this.deltaEndpointsState.get(deltaId);
        if (!deltaEndpoint) {
            deltaEndpoint = {};
            this.deltaEndpointsState.set(deltaId, deltaEndpoint);
        }
        return deltaEndpoint;
    }
    private getDeltaSettings(deltaId:symbol){
        let deltaEndpoint = this.deltaEndpointSettings.get(deltaId);
        if (!deltaEndpoint) {
            deltaEndpoint = {

            };
            this.deltaEndpointSettings.set(deltaId, deltaEndpoint);
        }
        return deltaEndpoint;
    }
    private updateInfo(data: EndpointInfo, deltaId: symbol) {
        _.merge(this.getDeltaSettings(deltaId), data);
    }
    private updateCapability<NS extends keyof EndpointCapability>(namespace: NS, value: SubType<EndpointCapability, NS>, deltaId: symbol) {
        this.getDeltaSettings(deltaId)[namespace]=value;
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

    private async waitDeltaPromises(deltaId:symbol){
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
    private async delegateDirective<NS extends keyof DirectiveHandlers, N extends keyof DirectiveHandlers[NS]>(commandArgs: string[], request: any, messageId: symbol): Promise<void> {
        const [namespaceValue, nameValue] = [...commandArgs];
        const namespace = <NS>namespaceValue;
        const name = <N>nameValue;
        const directiveHandler = this.directiveHandlers[namespace];
        console.time(messageId.toString())
        if (directiveHandler) {
            const supported: string[] = directiveHandler.supported;
            if (supported.indexOf(nameValue) >= 0) {
                const handleFunction = <Function><unknown>directiveHandler[name];
                try {
                    const respPayload = await handleFunction.bind(directiveHandler)(request);
                    const resp: ResponseMessage<any> = {
                        payload: respPayload.payload,
                        stateChange: respPayload.state,
                        error: false
                    }
                    this.alexaDirectiveEmitter.emit(namespace, name, request);
                    responseRouter.emit(messageId, resp);
                    console.timeEnd(messageId.toString())
                } catch (err) {
                    routeError(err, messageId);
                    console.timeEnd(messageId.toString())
                }
            } else {
                const error: ErrorHolder = {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                        message: 'Not supported command:' + namespace + ':' + nameValue
                    }
                }
                routeError(error, messageId);
                console.timeEnd(messageId.toString())
            }
        } else {
            const error: ErrorHolder = {
                errorType: 'Alexa',
                errorPayload: {
                    type: 'INVALID_DIRECTIVE',
                    message: 'Directive Handler Not Found:' + namespace
                }
            }
            routeError(error, messageId);
            console.timeEnd(messageId.toString())
        }
    }
}

function routeError(error: ErrorHolder, messageId: symbol) {
    console.error(error);
    responseRouter.emit(messageId, {
        error: true,
        payload: error
    });
}
class AlexaAssistant implements Assistant<'alexa'>{
    readonly name = 'alexa'
    createEndpointEmitter(endpointId: string): AlexaEndpointEmitter {
        return new AlexaEndpointEmitterNotifier(endpointId);
    }
    missingEndpointError(le: LocalEndpoint, messageId: symbol): void {
        const endpointId = generateEndpointId(le);
        const error: ErrorHolder = {
            errorType: 'Alexa',
            errorPayload: {
                type: 'NO_SUCH_ENDPOINT',
                message: 'Endpoint ' + endpointId + ' Not Found'
            }
        }
        routeError(error, messageId);
    }
}

export function registerAssistant() {
    providersEmitter.registerAssistant(new AlexaAssistant());
}
