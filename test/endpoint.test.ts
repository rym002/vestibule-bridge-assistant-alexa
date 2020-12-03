import { SeekController } from '@vestibule-link/alexa-video-skill-types';
import { providersEmitter } from '@vestibule-link/bridge-assistant';
import { EndpointInfo, EndpointState, endpointTopicPrefix, RequestMessage, SubType } from '@vestibule-link/iot-types';
import { iotshadow, mqtt } from 'aws-iot-device-sdk-v2';
import { assert } from 'chai';
import 'mocha';
import { createSandbox, createStubInstance, SinonSandbox, SinonStub, SinonStubbedInstance, SinonStubbedMember, stub, StubbableType } from 'sinon';
import { DirectiveHandlers, SupportedDirectives } from '../src/directive';
import { AlexaEndpointEmitter, registerAssistant } from '../src/endpoint';
import * as iot from '../src/iot';

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
describe('endpoint', () => {
    let createConnectionStub: SinonStub
    let connectionStub: StubbedClass<mqtt.MqttClientConnection>
    const encoder = new TextEncoder()
    const topicHandlerMap = {}
    async function emitTopic(listenTopic: string, topic: string, req: any) {
        await topicHandlerMap[listenTopic](topic, encoder.encode(JSON.stringify(req)))
    }
    before(async function () {
        process.env.CLIENT_ID = clientId
        connectionStub = createSinonStubInstance(mqtt.MqttClientConnection)
        connectionStub.publish.returns(Promise.resolve({}))
        connectionStub.subscribe.callsFake((topic, qos, on_message) => {
            topicHandlerMap[topic] = on_message
            return Promise.resolve({
                topic: topic,
                qos: qos
            })
        })
        createConnectionStub = stub(iot, 'createConnection').returns(Promise.resolve(connectionStub))
        await registerAssistant()
    })
    beforeEach(function () {
        const sandbox = createContextSandbox(this)
    })
    afterEach(function () {
        restoreSandbox(this)
    })
    after(() => {
        createConnectionStub.restore()
    })
    it('should request an endpoint refresh', async function () {
        const sandbox = getContextSandbox(this)
        const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', 'testProvider_testRefresh', true)
        const deltaId = Symbol()
        const emitStub = <SinonStub<any, boolean>>sandbox.stub(endpointEmitter, 'emit');
        endpointEmitter.refresh(deltaId);
        assert(emitStub.calledWith('refreshState', deltaId))
        assert(emitStub.calledWith('refreshCapability', deltaId))
        assert(emitStub.calledWith('refreshInfo', deltaId))
    })

    context('directives', () => {
        const directiveHandler = new TestDirectiveHandler();
        it('should reply on the sync topic', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testProvider_testDirectiveSync'
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointEmitter.registerDirectiveHandler(namespace, directiveHandler);
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    sync: `testResponse/${endpointId}`
                }
            }
            const resp = await emitTopic(`${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            assert(directiveSpy.calledWith(req.payload), 'Directive not called with payload');
            assert(connectionStub.publish.calledWith(req.replyTopic.sync), 'Wrong reply topic')
        })
        it('should reply on the sync topic when deferred is longer than response time', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testProvider_testDirectiveSyncDeferred'
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointEmitter.registerDirectiveHandler(namespace, directiveHandler);
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
            const resp = await emitTopic(`${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            assert(directiveSpy.calledWith(req.payload), 'Directive not called with payload');
            assert(connectionStub.publish.calledWith(req.replyTopic.sync), 'Wrong reply topic')
        })
        it('should reply on the async topic when deferred is shorter than response time', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testProvider_testDirectiveAsyncDeferred'
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointEmitter.registerDirectiveHandler(namespace, directiveHandler);
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
            const resp = await emitTopic(`${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            assert(directiveSpy.calledWith(req.payload), 'Directive not called with payload');
            assert(connectionStub.publish.calledWith(req.replyTopic.async), 'Wrong reply topic')
        })

        it('should not reply maxAllowed is shorter than response time', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testProvider_testDirectiveMaxAllowed'
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            const namespace = 'Alexa.SeekController'
            const name = 'AdjustSeekPosition'
            endpointEmitter.registerDirectiveHandler(namespace, directiveHandler);
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
            const resp = await emitTopic(`${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            assert(directiveSpy.calledWith(req.payload), 'Directive not called with payload');
            assert(!connectionStub.publish.calledWith(req.replyTopic.async), 'Topic publish outside allowed')
        })
        it('should send error for invalid directive', async function () {
            const endpointId = 'testProvider_testDirectiveError'
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
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
            const resp = await emitTopic(`${topicBase}#`, `${topicBase}${namespace}/AdjustSeekPosition`, req)
            assert(connectionStub.publish.calledWith(req.replyTopic.sync), 'Invalid Topic')
            assert(connectionStub.publish.calledWith(req.replyTopic.sync, {
                error: true,
                payload: {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'INVALID_DIRECTIVE',
                        message: `Directive Handler Not Found: ${namespace}`
                    }
                }
            }), 'Invalid Response Payload')
        })
        it('should send error for unsupported operation', async function () {
            const endpointId = 'testProvider_testDirectiveOperation'
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
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
            endpointEmitter.registerDirectiveHandler(namespace, new TestRecordDirectiveHandler());
            const name = 'StopRecording'
            const resp = await emitTopic(`${topicBase}#`, `${topicBase}${namespace}/${name}`, req)
            assert(connectionStub.publish.calledWith(req.replyTopic.sync), 'Invalid Topic')
            assert(connectionStub.publish.calledWith(req.replyTopic.sync, {
                error: true,
                payload: {
                    errorType: 'Alexa',
                    errorPayload: {
                        type: 'NOT_SUPPORTED_IN_CURRENT_MODE',
                        message: `Not supported command: ${namespace}:${name}`
                    }
                }
            }), 'Invalid Response Payload')
        })
    })
    context('state', () => {
        const delegateEndpointId = 'state_Endpoint'
        const delegateTopic = getShadowDeltaTopic(delegateEndpointId)
        before(async function () {
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', delegateEndpointId, true)
            this['emitter'] = endpointEmitter
        })
        it('should publish state changes', async function () {
            const endpointId = 'testProvider_testDelta'
            const sandbox = getContextSandbox(this)
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const deltaId = Symbol()
            const emitStub = sandbox.stub(providersEmitter, 'emit');
            endpointEmitter.emit('state', 'Alexa.PlaybackStateReporter', 'playbackState', { state: 'PLAYING' }, deltaId);
            await endpointEmitter.completeDeltaState(deltaId);
            const topic = `$aws/things/${clientId}/shadow/name/${endpointId}/update`;
            assert(emitStub.called, 'State event not published')
            assert(connectionStub.publish.calledWith(topic, JSON.stringify({
                shadowName: endpointId,
                thingName: clientId,
                state: {
                    reported: {
                        'Alexa.PlaybackStateReporter': {
                            playbackState: { state: 'PLAYING' }
                        }
                    }
                }
            })), 'Settings not published')
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
            before(async function () {
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                endpointEmitter.registerDirectiveHandler(namespace, new DirectiveHandler());
                this['emitter'] = endpointEmitter
            })
            it('should call ChangeChannel', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[namespace], 'ChangeChannel')
                const state: EndpointState = {
                    [namespace]: {
                        channel: {
                            number: '123'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
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
            before(async function () {
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                endpointEmitter.registerDirectiveHandler(directiveNamespace, new DirectiveHandler());
                this['emitter'] = endpointEmitter
            })
            it('should call Play', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[directiveNamespace], 'Play')
                const state: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: 'PLAYING'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
            })

            it('should call Pause', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[directiveNamespace], 'Pause')
                const state: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: 'PAUSED'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
            })
            it('should call Stop', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[directiveNamespace], 'Stop')
                const state: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: 'STOPPED'
                        }
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
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
            before(async function () {
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                endpointEmitter.registerDirectiveHandler(namespace, new DirectiveHandler());
                this['emitter'] = endpointEmitter
            })
            it('should call TurnOff', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[namespace], 'TurnOff')
                const state: EndpointState = {
                    [namespace]: {
                        powerState: 'OFF'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
            })
            it('should call TurnOn', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[namespace], 'TurnOn')
                const state: EndpointState = {
                    [namespace]: {
                        powerState: 'ON'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
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
            before(async function () {
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                endpointEmitter.registerDirectiveHandler(namespace, new DirectiveHandler());
                this['emitter'] = endpointEmitter
            })
            it('should call StartRecording', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[namespace], 'StartRecording')
                const state: EndpointState = {
                    [namespace]: {
                        RecordingState: 'RECORDING'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
            })
            it('should call StopRecording', async function () {
                const sandbox = getContextSandbox(this)
                const endpointEmitter: AlexaEndpointEmitter = this['emitter']
                const handlerSpy = sandbox.spy(endpointEmitter.directiveHandlers[namespace], 'StopRecording')
                const state: EndpointState = {
                    [namespace]: {
                        RecordingState: 'NOT_RECORDING'
                    }
                }
                const req: iotshadow.model.ShadowDeltaUpdatedEvent = {
                    state: state
                }
                await emitTopic(delegateTopic, delegateTopic, req)
                assert(handlerSpy.called, 'Handler not called')
            })

        })
    })
    context('settings', () => {
        it('should emit settings when a capability is updated', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testCapabilities';
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const deltaId = Symbol()
            const emitStub = sandbox.stub(providersEmitter.getEndpointSettingsEmitter('alexa'), 'emit');
            endpointEmitter.emit('capability', 'Alexa.ChannelController', ['channel'], deltaId);
            await endpointEmitter.completeDeltaSettings(deltaId);
            assert(emitStub.calledOnceWith('settings', endpointId, {
                'Alexa.ChannelController': ['channel']
            }), 'Settings event not sent')

            const topic = endpointTopicPrefix(clientId, 'alexa', endpointId) + 'settings'
            assert(connectionStub.publish.calledWith(topic), 'Settings topic not published')

        })
        it('should emit settings when info is updated', async function () {
            const sandbox = getContextSandbox(this)
            const endpointId = 'testInfo';
            const endpointEmitter = <AlexaEndpointEmitter>await providersEmitter.getEndpointEmitter('alexa', endpointId, true)
            const deltaId = Symbol()
            const emitStub = sandbox.stub(providersEmitter.getEndpointSettingsEmitter('alexa'), 'emit');
            const info: EndpointInfo = {
                endpointId: endpointId,
                description: 'desc',
                friendlyName: 'friend',
                manufacturerName: 'manufacturer',
                displayCategories: ['ACTIVITY_TRIGGER']
            }
            endpointEmitter.emit('info', info, deltaId);
            await endpointEmitter.completeDeltaSettings(deltaId);
            assert(emitStub.calledOnceWith('settings', endpointId, info), 'Settings event not sent')

            const topic = endpointTopicPrefix(clientId, 'alexa', endpointId) + 'settings'
            assert(connectionStub.publish.calledWith(topic), 'Settings topic not published')

        })
    })
})

type StubbedClass<T> = SinonStubbedInstance<T> & T;
function createSinonStubInstance<T>(
    constructor: StubbableType<T>,
    overrides?: { [K in keyof T]?: SinonStubbedMember<T[K]> },
): StubbedClass<T> {
    const stub = createStubInstance<T>(constructor, overrides);
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