import { SeekController } from '@vestibule-link/alexa-video-skill-types';
import { serviceProviderManager } from '@vestibule-link/bridge-service-provider';
import * as iot from '@vestibule-link/bridge-gateway-aws/dist/iot';
import { EndpointInfo, EndpointState, endpointTopicPrefix, RequestMessage, SubType } from '@vestibule-link/iot-types';
import { iotshadow, mqtt } from 'aws-iot-device-sdk-v2';
import 'mocha';
import { createSandbox, match, SinonSandbox, SinonStub, SinonStubbedInstance, SinonStubbedMember, StubbableType } from 'sinon';
import { DirectiveHandlers, SupportedDirectives } from '../src/directive';
import { AlexaEndpointConnector, registerAssistant } from '../src/endpoint';


type StatelessPayload<T> = {
    payload: T
}
class TestDirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.SeekController'>{
    readonly supported: SupportedDirectives<'Alexa.SeekController'> = ['AdjustSeekPosition'];
    async AdjustSeekPosition(payload: SeekController.RequestPayload): Promise<StatelessPayload<SeekController.ResponsePayload>> {

        return {
            payload: {
                properties: [{
                    name: 'positionMilliseconds',
                    value: 1
                }]
            }
        }

    }
}
class TestRecordDirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.RecordController'>{
    readonly supported: SupportedDirectives<'Alexa.RecordController'> = ['StartRecording'];
    async StartRecording(payload: {}): Promise<StatelessPayload<{}>> {
        return {
            payload: {}
        }
    }
    async StopRecording(payload: {}): Promise<StatelessPayload<{}>> {
        return {
            payload: {}
        }
    }
}
const clientId = 'testClientId'
interface TopicHandlerMap {
    [index: string]: (topic: string, payload: ArrayBuffer) => void | Promise<void>
}
const encoder = new TextEncoder()

async function emitTopic(topicHandlerMap: TopicHandlerMap, listenTopic: string, topic: string, req: any) {
    const topicHandler = topicHandlerMap[listenTopic]
    if (topicHandler) {
        await topicHandler(topic, encoder.encode(JSON.stringify(req)))
    } else {
        throw new Error(`Topic Handler not found for ${listenTopic}`)
    }
}

describe('endpoint', () => {
    before(async function () {
        process.env.AWS_CLIENT_ID = clientId
        await registerAssistant()
    })
    beforeEach(function () {
        const sandbox = createContextSandbox(this)
        const topicHandlerMap: TopicHandlerMap = {}

        const connectionStub = createSinonStubInstance(sandbox, mqtt.MqttClientConnection)
        connectionStub.publish.returns(Promise.resolve({}))
        connectionStub.subscribe.callsFake((topic, qos, on_message) => {
            topicHandlerMap[topic] = on_message
            return Promise.resolve({
                topic: topic,
                qos: qos
            })
        })
        const createConnectionStub = sandbox.stub(iot, 'awsConnection').returns(connectionStub)
        this.currentTest['topicHandlerMap'] = topicHandlerMap
        this.currentTest['connection'] = connectionStub
    })
    afterEach(function () {
        restoreSandbox(this)
    })

    it('should request an endpoint refresh', async function () {
        const sandbox = getContextSandbox(this)
        const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', 'testProvider_testRefresh', true)
        const deltaId = Symbol()
        const emitStub = <SinonStub<any, boolean>>sandbox.stub(endpointConnector, 'emit');
        endpointConnector.refresh(deltaId);
        sandbox.assert.calledWith(emitStub, 'refreshState', deltaId)
        sandbox.assert.calledWith(emitStub, 'refreshCapability', deltaId)
        sandbox.assert.calledWith(emitStub, 'refreshInfo', deltaId)
    })

    context('directives', () => {
        const directiveHandler = new TestDirectiveHandler();
        it('should reply on the sync topic', async function () {
            const sandbox = getContextSandbox(this)
            const topicHandlerMap = this.test['topicHandlerMap']
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointId = 'testProvider_testDirectiveSync'
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    sync: `testResponse/${endpointId}`
                }
            }
            const resp = await emitTopic(topicHandlerMap, `${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.sync, match.object, mqtt.QoS.AtMostOnce)
        })
        it('should reply on the sync topic when deferred is longer than response time', async function () {
            const sandbox = getContextSandbox(this)
            const topicHandlerMap = this.test['topicHandlerMap']
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointId = 'testProvider_testDirectiveSyncDeferred'
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    async: `testResponseAsync/${endpointId}`,
                    sync: `testResponseSync/${endpointId}`
                },
                responseTime: {
                    maxAllowed: 100,
                    deferred: 100
                }
            }
            const resp = await emitTopic(topicHandlerMap, `${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.sync, match.object, mqtt.QoS.AtMostOnce)
        })
        it('should reply on the async topic when deferred is shorter than response time', async function () {
            const sandbox = getContextSandbox(this)
            const topicHandlerMap = this.test['topicHandlerMap']
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointId = 'testProvider_testDirectiveAsyncDeferred'
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    async: `testResponseAsync/${endpointId}`,
                    sync: `testResponseSync/${endpointId}`
                },
                responseTime: {
                    maxAllowed: 100,
                    deferred: 0
                }
            }
            const resp = await emitTopic(topicHandlerMap, `${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.async, match.object, mqtt.QoS.AtMostOnce)
        })

        it('should not reply maxAllowed is shorter than response time', async function () {
            const sandbox = getContextSandbox(this)
            const topicHandlerMap = this.test['topicHandlerMap']
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointId = 'testProvider_testDirectiveMaxAllowed'
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    async: `testResponseAsync/${endpointId}`,
                    sync: `testResponseSync/${endpointId}`
                },
                responseTime: {
                    maxAllowed: 0,
                    deferred: 0
                }
            }
            const resp = await emitTopic(topicHandlerMap, `${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledOnce(connection.publish)
        })
        it('should send error for invalid directive', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testProvider_testDirectiveError'
            const topicHandlerMap = this.test['topicHandlerMap']
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    sync: `testResponse/${endpointId}`
                }
            }
            const namespace = 'Alexa.SeekController'
            const resp = await emitTopic(topicHandlerMap, `${topicBase}#`, `${topicBase}${namespace}/AdjustSeekPosition`, req)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.sync, {
                error: true,
                payload: {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'INVALID_DIRECTIVE',
                        message: `Directive Handler Not Found: ${namespace}`
                    }
                }
            }, mqtt.QoS.AtMostOnce)
        })
        it('should send error for unsupported operation', async function () {
            const endpointId = 'testProvider_testDirectiveOperation'
            const sandbox = getContextSandbox(this)
            const topicHandlerMap = this.test['topicHandlerMap']
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    sync: `testResponse/${endpointId}`
                }
            }
            const namespace = 'Alexa.RecordController'
            endpointConnector.registerDirectiveHandler(namespace, new TestRecordDirectiveHandler());
            const name = 'StopRecording'
            const resp = await emitTopic(topicHandlerMap, `${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.sync, {
                error: true,
                payload: {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                        message: `Not supported command: ${namespace}:${name}`
                    }
                }
            }, mqtt.QoS.AtMostOnce)
        })
    })
    context('state', () => {
        beforeEach(async function () {
            const id = this.currentTest.title.replace(/ /g, '')
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', id, true)
            this.currentTest['connector'] = endpointConnector
        })
        it('should publish state changes', async function () {
            const endpointId = 'testProvider_testDelta'
            const sandbox = getContextSandbox(this)
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const deltaId = Symbol()
            endpointConnector.updateState('Alexa.PlaybackStateReporter', 'playbackState', { state: 'PLAYING' }, deltaId);
            await endpointConnector.completeDeltaState(deltaId);
            const topic = `$aws/things/${clientId}/shadow/name/${endpointId}/update`;
            sandbox.assert.calledWith(connection.publish, topic, JSON.stringify({
                shadowName: endpointId,
                thingName: clientId,
                desired: {
                    'Alexa.PlaybackStateReporter': null
                },
                reported: {
                    'Alexa.PlaybackStateReporter': {
                        playbackState: { state: 'PLAYING' }
                    }
                }
            }), mqtt.QoS.AtLeastOnce)
        })
        context('ChannelController', () => {
            class DirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.ChannelController'>{
                readonly supported: SupportedDirectives<'Alexa.ChannelController'> = ['ChangeChannel'];
                async ChangeChannel(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async SkipChannels(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
            }
            const namespace = 'Alexa.ChannelController'
            beforeEach(async function () {
                const endpointConnector: AlexaEndpointConnector = this.currentTest['connector']
                endpointConnector.registerDirectiveHandler(namespace, new DirectiveHandler());
            })
            it('should call ChangeChannel', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], 'ChangeChannel')
                const state: EndpointState = {
                    [namespace]: {
                        channel: {
                            number: '123'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })
        })
        context('PlaybackStateReporter', () => {
            class DirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.PlaybackController'>{
                readonly supported: SupportedDirectives<'Alexa.PlaybackController'> = ['Play', 'Pause', 'Stop'];
                async Play(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async Pause(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async Stop(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async FastForward(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async Rewind(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async Next(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async Previous(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async StartOver(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
            }
            const namespace = 'Alexa.PlaybackStateReporter'
            const directiveNamespace = 'Alexa.PlaybackController'
            beforeEach(async function () {
                const endpointConnector: AlexaEndpointConnector = this.currentTest['connector']
                endpointConnector.registerDirectiveHandler(directiveNamespace, new DirectiveHandler());
            })
            it('should call Play', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[directiveNamespace], 'Play')
                const state: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: 'PLAYING'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })

            it('should call Pause', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[directiveNamespace], 'Pause')
                const state: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: 'PAUSED'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })
            it('should call Stop', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[directiveNamespace], 'Stop')
                const state: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: 'STOPPED'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })
        })
        context('PowerController', () => {
            class DirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.PowerController'>{
                readonly supported: SupportedDirectives<'Alexa.PowerController'> = ['TurnOff', 'TurnOn'];
                async TurnOff(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async TurnOn(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
            }
            const namespace = 'Alexa.PowerController'
            beforeEach(async function () {
                const endpointConnector: AlexaEndpointConnector = this.currentTest['connector']
                endpointConnector.registerDirectiveHandler(namespace, new DirectiveHandler());
            })
            it('should call TurnOff', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], 'TurnOff')
                const state: EndpointState = {
                    [namespace]: {
                        powerState: 'OFF'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })
            it('should call TurnOn', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], 'TurnOn')
                const state: EndpointState = {
                    [namespace]: {
                        powerState: 'ON'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })

        })
        context('RecordController', () => {
            class DirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.RecordController'>{
                readonly supported: SupportedDirectives<'Alexa.RecordController'> = ['StartRecording', 'StopRecording'];
                async StartRecording(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
                async StopRecording(payload: {}): Promise<StatelessPayload<{}>> {
                    return {
                        payload: {}
                    }
                }
            }
            const namespace = 'Alexa.RecordController'
            beforeEach(async function () {
                const endpointConnector: AlexaEndpointConnector = this.currentTest['connector']
                endpointConnector.registerDirectiveHandler(namespace, new DirectiveHandler());
            })
            it('should call StartRecording', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], 'StartRecording')
                const state: EndpointState = {
                    [namespace]: {
                        RecordingState: 'RECORDING'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })
            it('should call StopRecording', async function () {
                const sandbox = getContextSandbox(this)
                const topicHandlerMap = this.test['topicHandlerMap']
                const endpointConnector: AlexaEndpointConnector = this.test['connector']
                const delegateTopic = getShadowDeltaTopic(endpointConnector.endpointId)
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], 'StopRecording')
                const state: EndpointState = {
                    [namespace]: {
                        RecordingState: 'NOT_RECORDING'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state,
                    version: 1
                }
                await emitTopic(topicHandlerMap, delegateTopic, delegateTopic, req)
                sandbox.assert.called(handlerSpy)
            })

        })
    })
    context('settings', () => {
        it('should publish settings when a capability is updated', async function () {
            const sandbox = getContextSandbox(this)
            const connection: StubbedClass<mqtt.MqttClientConnection> = this.test['connection']
            const endpointId = 'testCapabilities';
            const endpointConnector = await serviceProviderManager.getEndpointConnector('alexa', endpointId, true)
            const deltaId = Symbol()
            endpointConnector.updateCapability('Alexa.ChannelController', ['channel'], deltaId);
            await endpointConnector.completeDeltaSettings(deltaId);

            const topic = endpointTopicPrefix(clientId, 'alexa', endpointId) + 'settings'
            sandbox.assert.calledWith(connection.publish, topic, {
                'Alexa.ChannelController': ['channel']
            }, mqtt.QoS.AtMostOnce)

        })
    })
})

type StubbedClass<T> = SinonStubbedInstance<T> & T;
function createSinonStubInstance<T>(
    sandbox: SinonSandbox,
    constructor: StubbableType<T>,
    overrides?: { [K in keyof T]?: SinonStubbedMember<T[K]> },
): StubbedClass<T> {
    const stub = sandbox.createStubInstance<T>(constructor, overrides);
    return stub as unknown as StubbedClass<T>;
}

function createContextSandbox(context: Mocha.Context): SinonSandbox {
    const sandbox = createSandbox({
        useFakeTimers: true
    })
    context.currentTest['sandbox'] = sandbox
    return sandbox
}

function restoreSandbox(context: Mocha.Context) {
    context.currentTest['sandbox'].restore()
}

function getContextSandbox(context: Mocha.Context): SinonSandbox {
    return context.test['sandbox']
}

function getDirectiveTopicBase(endpointId: string) {
    return `vestibule-bridge/${clientId}/alexa/endpoint/${endpointId}/directive/`
}

function getShadowDeltaTopic(endpointId: string) {
    return `$aws/things/${clientId}/shadow/name/${endpointId}/update/delta`
}