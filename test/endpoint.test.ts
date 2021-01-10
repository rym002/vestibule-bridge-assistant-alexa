import { PlaybackController, PlaybackStateReporter, PowerController, RecordController, SeekController } from '@vestibule-link/alexa-video-skill-types';
import { serviceProviderManager } from '@vestibule-link/bridge-service-provider';
import * as iot from '@vestibule-link/bridge-gateway-aws/dist/iot';
import { EndpointInfo, EndpointState, endpointTopicPrefix, RequestMessage, SubType } from '@vestibule-link/iot-types';
import { iotshadow, mqtt } from 'aws-iot-device-sdk-v2';
import 'mocha';
import Sinon, { createSandbox, match, SinonSandbox, SinonSpy, SinonStub, SinonStubbedInstance, SinonStubbedMember, StubbableType } from 'sinon';
import { DirectiveHandlers, SupportedDirectives } from '../src/directive';
import { AlexaEndpointConnector, registerAssistant } from '../src/endpoint';
import { EventEmitter } from 'events';


type StatelessPayload<T> = {
    payload: T
}
class TestDirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.SeekController'>{
    readonly supported: SupportedDirectives<'Alexa.SeekController'> = ['AdjustSeekPosition'];
    public getMockResponse(): StatelessPayload<SeekController.ResponsePayload> {
        return {
            payload: {
                properties: [{
                    name: 'positionMilliseconds',
                    value: 1
                }]
            }
        }
    }
    async AdjustSeekPosition(payload: SeekController.RequestPayload): Promise<StatelessPayload<SeekController.ResponsePayload>> {
        return this.getMockResponse()
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
        const emitStub = <SinonStub<any, boolean>>sandbox.stub(<EventEmitter><unknown>endpointConnector, 'emit');
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
            await endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
            const topicBase = getDirectiveTopicBase(endpointId)
            const req: RequestMessage<any> = {
                payload: {
                    d: 1
                },
                replyTopic: {
                    sync: `testResponse/${endpointId}`
                }
            }
            const topicName = `${topicBase}${namespace}/${name}`
            const resp = await emitTopic(topicHandlerMap, topicName, topicName, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.sync, {
                ...directiveHandler.getMockResponse(),
                error: false
            }
                , mqtt.QoS.AtMostOnce)
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
            await endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
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
            const topicName = `${topicBase}${namespace}/${name}`
            const resp = await emitTopic(topicHandlerMap, topicName, topicName, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.sync, {
                ...directiveHandler.getMockResponse(),
                error: false
            }, mqtt.QoS.AtMostOnce)
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
            await endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
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
            const topicName = `${topicBase}${namespace}/${name}`
            const resp = await emitTopic(topicHandlerMap, topicName, topicName, req)
            sandbox.assert.calledWith(directiveSpy, req.payload)
            sandbox.assert.calledWith(connection.publish, req.replyTopic.async, {
                ...directiveHandler.getMockResponse(),
                error: false
            }, mqtt.QoS.AtMostOnce)
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
            await endpointConnector.registerDirectiveHandler(namespace, directiveHandler);
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
            const topicName = `${topicBase}${namespace}/${name}`
            const resp = await emitTopic(topicHandlerMap, topicName, topicName, req)
            sandbox.assert.calledOnce(connection.publish)
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
                state: {
                    desired: {
                        'Alexa.PlaybackStateReporter': null
                    },
                    reported: {
                        'Alexa.PlaybackStateReporter': {
                            playbackState: { state: 'PLAYING' }
                        }
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
                await endpointConnector.registerDirectiveHandler(namespace, new DirectiveHandler());
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
        async function emitCurrentState(context: Mocha.Context, currentState: EndpointState) {
            const endpointConnector: AlexaEndpointConnector = context.currentTest['connector']
            const topicHandlerMap = context.currentTest['topicHandlerMap']
            const acceptedTopic = getShadowAcceptedTopic(endpointConnector.endpointId)
            const currentStateReq: iotshadow.model.UpdateShadowResponse = {
                state: {
                    reported: currentState
                },
                version: 1
            }
            await emitTopic(topicHandlerMap, acceptedTopic, acceptedTopic, currentStateReq)
        }
        async function emitStateDelta(context: Mocha.Context, desiredState: EndpointState) {
            const topicHandlerMap = context.test['topicHandlerMap']
            const endpointConnector: AlexaEndpointConnector = context.test['connector']

            const deltaTopic = getShadowDeltaTopic(endpointConnector.endpointId)
            const deltaReq: iotshadow.model.ShadowDeltaUpdatedEvent = {
                state: desiredState,
                version: 2
            }
            await emitTopic(topicHandlerMap, deltaTopic, deltaTopic, deltaReq)
        }
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
                await endpointConnector.registerDirectiveHandler(directiveNamespace, new DirectiveHandler());
            })

            async function testPlaybackState(context: Mocha.Context, operation: PlaybackController.Operations, desiredPlaybackState: PlaybackStateReporter.States): Promise<SinonSpy> {
                const sandbox = getContextSandbox(context)
                const endpointConnector: AlexaEndpointConnector = context.test['connector']
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[directiveNamespace], operation)

                const desiredState: EndpointState = {
                    [namespace]: {
                        playbackState: {
                            state: desiredPlaybackState
                        }
                    }
                }
                await emitStateDelta(context, desiredState)
                return handlerSpy
            }
            context('Current PLAYING', () => {
                beforeEach(async function () {
                    const currentState: EndpointState = {
                        [namespace]: {
                            playbackState: {
                                state: 'PLAYING'
                            }
                        }
                    }
                    await emitCurrentState(this, currentState)
                })
                it('PAUSED should call Pause when PLAYING', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Pause', 'PAUSED')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.called(handlerSpy)
                })

                it('STOPPED should call Stop when PLAYING', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Pause', 'PAUSED')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.called(handlerSpy)
                })
                it('PLAYING Should not call Play when PLAYING', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Play', 'PLAYING')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })

            })

            context('Current PAUSED', () => {
                beforeEach(async function () {
                    const currentState: EndpointState = {
                        [namespace]: {
                            playbackState: {
                                state: 'PAUSED'
                            }
                        }
                    }
                    await emitCurrentState(this, currentState)
                })
                it('PAUSED should not call Pause when PAUSED', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Pause', 'PAUSED')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })
                it('STOPPED should call Stop when PAUSED', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Stop', 'STOPPED')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.called(handlerSpy)
                })
                it('PLAYING should call Play when PAUSED', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Play', 'PLAYING')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.called(handlerSpy)
                })

            })
            context('Current STOPPED', () => {
                beforeEach(async function () {
                    const currentState: EndpointState = {
                        [namespace]: {
                            playbackState: {
                                state: 'STOPPED'
                            }
                        }
                    }
                    await emitCurrentState(this, currentState)
                })
                it('STOPPED should not call Stop when STOPPED', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Stop', 'STOPPED')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })
                it('PLAYING should not call Play when STOPPED', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Play', 'PLAYING')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })
                it('PAUSED should not call Pause when STOPPED', async function () {
                    const handlerSpy = await testPlaybackState(this, 'Pause', 'PAUSED')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })
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
            async function testPowerController(context: Mocha.Context, operation: PowerController.Operations, desiredPowerState: PowerController.States): Promise<SinonSpy> {
                const sandbox = getContextSandbox(context)
                const endpointConnector: AlexaEndpointConnector = context.test['connector']
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], operation)

                const desiredState: EndpointState = {
                    [namespace]: {
                        powerState: desiredPowerState
                    }
                }
                await emitStateDelta(context, desiredState)
                return handlerSpy
            }
            beforeEach(async function () {
                const endpointConnector: AlexaEndpointConnector = this.currentTest['connector']
                await endpointConnector.registerDirectiveHandler(namespace, new DirectiveHandler());
            })
            context('Current ON', () => {
                beforeEach(async function () {
                    const currentState: EndpointState = {
                        [namespace]: {
                            powerState: 'ON'
                        }
                    }
                    await emitCurrentState(this, currentState)
                })

                it('ON Should not call TurnOn when ON', async function () {
                    const handlerSpy = await testPowerController(this, 'TurnOn', 'ON')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })

                it('OFF Should call TurnOff when ON', async function () {
                    const handlerSpy = await testPowerController(this, 'TurnOff', 'OFF')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.called(handlerSpy)
                })
            })
            context('Current OFF', () => {
                beforeEach(async function () {
                    const currentState: EndpointState = {
                        [namespace]: {
                            powerState: 'OFF'
                        }
                    }
                    await emitCurrentState(this, currentState)
                })

                it('ON Should call TurnOn when OFF', async function () {
                    const handlerSpy = await testPowerController(this, 'TurnOn', 'ON')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.called(handlerSpy)
                })

                it('OFF Should not call TurnOff when OFF', async function () {
                    const handlerSpy = await testPowerController(this, 'TurnOff', 'OFF')
                    const sandbox = getContextSandbox(this)
                    sandbox.assert.notCalled(handlerSpy)
                })
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
            async function testRecordController(context: Mocha.Context, operation: RecordController.Operations, desiredRecordState: RecordController.States): Promise<SinonSpy> {
                const sandbox = getContextSandbox(context)
                const endpointConnector: AlexaEndpointConnector = context.test['connector']
                const handlerSpy = sandbox.spy(endpointConnector.directiveHandlers[namespace], operation)

                const desiredState: EndpointState = {
                    [namespace]: {
                        RecordingState: desiredRecordState
                    }
                }
                await emitStateDelta(context, desiredState)
                return handlerSpy
            }
            beforeEach(async function () {
                const endpointConnector: AlexaEndpointConnector = this.currentTest['connector']
                await endpointConnector.registerDirectiveHandler(namespace, new DirectiveHandler());
            })

            context('Current RECORDING', () => {
                context('Current PLAYING', () => {
                    beforeEach(async function () {
                        const currentState: EndpointState = {
                            [namespace]: {
                                RecordingState: 'RECORDING'
                            },
                            "Alexa.PlaybackStateReporter": {
                                playbackState: {
                                    state: 'PLAYING'
                                }
                            }
                        }
                        await emitCurrentState(this, currentState)
                    })

                    it('RECORDING Should not call StartRecording when RECORDING and PLAYING', async function () {
                        const handlerSpy = await testRecordController(this, 'StartRecording', 'RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })

                    it('NOT_RECORDING Should call StopRecording when RECORDING and PLAYING', async function () {
                        const handlerSpy = await testRecordController(this, 'StopRecording', 'NOT_RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.called(handlerSpy)
                    })
                })
                context('Current PAUSED', () => {
                    beforeEach(async function () {
                        const currentState: EndpointState = {
                            [namespace]: {
                                RecordingState: 'RECORDING'
                            },
                            "Alexa.PlaybackStateReporter": {
                                playbackState: {
                                    state: 'PAUSED'
                                }
                            }
                        }
                        await emitCurrentState(this, currentState)
                    })

                    it('RECORDING Should not call StartRecording when RECORDING and PAUSED', async function () {
                        const handlerSpy = await testRecordController(this, 'StartRecording', 'RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })

                    it('NOT_RECORDING Should call StopRecording when RECORDING and PAUSED', async function () {
                        const handlerSpy = await testRecordController(this, 'StopRecording', 'NOT_RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.called(handlerSpy)
                    })
                })
                context('Current STOPPED', () => {
                    beforeEach(async function () {
                        const currentState: EndpointState = {
                            [namespace]: {
                                RecordingState: 'RECORDING'
                            },
                            "Alexa.PlaybackStateReporter": {
                                playbackState: {
                                    state: 'STOPPED'
                                }
                            }
                        }
                        await emitCurrentState(this, currentState)
                    })

                    it('RECORDING Should not call StartRecording when RECORDING and STOPPED', async function () {
                        const handlerSpy = await testRecordController(this, 'StartRecording', 'RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })

                    it('NOT_RECORDING Should call StopRecording when RECORDING and STOPPED', async function () {
                        const handlerSpy = await testRecordController(this, 'StopRecording', 'NOT_RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.called(handlerSpy)
                    })
                })
            })
            context('Current NOT_RECORDING', () => {
                context('Current PLAYING', () => {
                    beforeEach(async function () {
                        const currentState: EndpointState = {
                            [namespace]: {
                                RecordingState: 'NOT_RECORDING'
                            },
                            "Alexa.PlaybackStateReporter": {
                                playbackState: {
                                    state: 'PLAYING'
                                }
                            }
                        }
                        await emitCurrentState(this, currentState)
                    })

                    it('RECORDING Should call StartRecording when NOT_RECORDING and PLAYING', async function () {
                        const handlerSpy = await testRecordController(this, 'StartRecording', 'RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.called(handlerSpy)
                    })

                    it('NOT_RECORDING Should not call StopRecording when NOT_RECORDING and PLAYING', async function () {
                        const handlerSpy = await testRecordController(this, 'StopRecording', 'NOT_RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })
                })
                context('Current PAUSED', () => {
                    beforeEach(async function () {
                        const currentState: EndpointState = {
                            [namespace]: {
                                RecordingState: 'NOT_RECORDING'
                            },
                            "Alexa.PlaybackStateReporter": {
                                playbackState: {
                                    state: 'PAUSED'
                                }
                            }
                        }
                        await emitCurrentState(this, currentState)
                    })

                    it('RECORDING Should call StartRecording when NOT_RECORDING and PAUSED', async function () {
                        const handlerSpy = await testRecordController(this, 'StartRecording', 'RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.called(handlerSpy)
                    })

                    it('NOT_RECORDING Should not call StopRecording when NOT_RECORDING and PAUSED', async function () {
                        const handlerSpy = await testRecordController(this, 'StopRecording', 'NOT_RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })
                })
                context('Current STOPPED', () => {
                    beforeEach(async function () {
                        const currentState: EndpointState = {
                            [namespace]: {
                                RecordingState: 'NOT_RECORDING'
                            },
                            "Alexa.PlaybackStateReporter": {
                                playbackState: {
                                    state: 'STOPPED'
                                }
                            }
                        }
                        await emitCurrentState(this, currentState)
                    })

                    it('RECORDING Should not call StartRecording when NOT_RECORDING and STOPPED', async function () {
                        const handlerSpy = await testRecordController(this, 'StartRecording', 'RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })

                    it('NOT_RECORDING Should not call StopRecording when NOT_RECORDING and STOPPED', async function () {
                        const handlerSpy = await testRecordController(this, 'StopRecording', 'NOT_RECORDING')
                        const sandbox = getContextSandbox(this)
                        sandbox.assert.notCalled(handlerSpy)
                    })
                })
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

function getShadowAcceptedTopic(endpointId: string) {
    return `$aws/things/${clientId}/shadow/name/${endpointId}/update/accepted`
}