import 'mocha'
import { registerAssistant, AlexaEndpointEmitter } from '../src/endpoint'
import { assert, expect } from 'chai'
import { providersEmitter, responseRouter } from '@vestibule-link/bridge-assistant';
import { createSandbox, SinonSandbox, SinonStub } from 'sinon';
import { SubType, ResponseMessage } from '@vestibule-link/iot-types';
import { DirectiveHandlers, SupportedDirectives } from '../src/directive';
import { SeekController, RecordController } from '@vestibule-link/alexa-video-skill-types';

class TestDirectiveHandler implements SubType<DirectiveHandlers, 'Alexa.SeekController'>{
    readonly supported: SupportedDirectives<'Alexa.SeekController'> = ['AdjustSeekPosition'];
    async AdjustSeekPosition(payload: SeekController.RequestPayload): Promise<{
        payload: SeekController.ResponsePayload
    }> {

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
    async StartRecording(payload: {}): Promise<{
        payload: {}
    }> {
        return {
            payload: {}
        }
    }
    async StopRecording(payload: {}): Promise<{
        payload: {}
    }> {
        return {
            payload: {}
        }
    }
}

describe('endpoint', () => {
    let sandbox: SinonSandbox
    before(() => {
        sandbox = createSandbox()
        registerAssistant()
    })
    afterEach(() => {
        sandbox.restore();
    })
    it('should emit delta', () => {
        const endpointEmitter = <AlexaEndpointEmitter>providersEmitter.getEndpointEmitter('alexa', {
            provider: 'testProvider',
            host: 'testDelta'
        }, true)
        const deltaId = Symbol()
        const emitStub = sandbox.stub(providersEmitter, 'emit');
        endpointEmitter.emit('state', 'Alexa.PlaybackStateReporter', 'playbackState', 'PLAYING', deltaId);
        endpointEmitter.completeDelta(deltaId);
        assert(emitStub.calledOnce)
    })

    it('should request an endpoint refresh', () => {
        const endpointEmitter = <AlexaEndpointEmitter>providersEmitter.getEndpointEmitter('alexa', {
            provider: 'testProvider',
            host: 'testRefresh'
        }, true)
        const deltaId = Symbol()
        const emitStub = <SinonStub<any, boolean>>sandbox.stub(endpointEmitter, 'emit');
        endpointEmitter.refresh(deltaId);
        assert(emitStub.calledWith('refreshState', deltaId))
        assert(emitStub.calledWith('refreshCapability', deltaId))
        assert(emitStub.calledWith('refreshInfo', deltaId))
    })

    context('directives', () => {
        const directiveHandler = new TestDirectiveHandler();
        it('should delegate to the directiveHandler', (done) => {
            const endpointEmitter = <AlexaEndpointEmitter>providersEmitter.getEndpointEmitter('alexa', {
                provider: 'testProvider',
                host: 'testDirective'
            }, true)
            const messageId = Symbol()
            responseRouter.once(messageId, (response: ResponseMessage<any>) => {
                expect(response).to.have.property('error')
                    .to.be.false
                done();
            })
            const directiveSpy = sandbox.spy(directiveHandler, 'AdjustSeekPosition');
            endpointEmitter.registerDirectiveHandler('Alexa.SeekController', directiveHandler);
            endpointEmitter.emit('directive', ['Alexa.SeekController', 'AdjustSeekPosition'], {}, messageId)
            assert(directiveSpy.calledOnce);
        })
        it('should send error for invalid directive', (done) => {
            const endpointEmitter = <AlexaEndpointEmitter>providersEmitter.getEndpointEmitter('alexa', {
                provider: 'testProvider',
                host: 'testDirectiveError'
            }, true)
            const messageId = Symbol()
            responseRouter.once(messageId, (response: ResponseMessage<any>) => {
                expect(response).to.have.property('error')
                    .to.be.true
                expect(response.payload).to.have.property('errorPayload')
                    .to.have.property('type')
                    .to.be.eql('INVALID_DIRECTIVE')
                done();
            })
            endpointEmitter.registerDirectiveHandler('Alexa.SeekController', directiveHandler);
            endpointEmitter.emit('directive', ['Alexa.PlaybackController', 'Play'], {}, messageId)
        })
        it('should send error for unsupported operation',(done)=>{
            const endpointEmitter = <AlexaEndpointEmitter>providersEmitter.getEndpointEmitter('alexa', {
                provider: 'testProvider',
                host: 'testDirectiveOperation'
            }, true)
            const messageId = Symbol()
            responseRouter.once(messageId, (response: ResponseMessage<any>) => {
                expect(response).to.have.property('error')
                    .to.be.true
                expect(response.payload).to.have.property('errorPayload')
                    .to.have.property('type')
                    .to.be.eql('NOT_SUPPORTED_IN_CURRENT_MODE')
                done();
            })
            endpointEmitter.registerDirectiveHandler('Alexa.RecordController', new TestRecordDirectiveHandler());
            endpointEmitter.emit('directive', ['Alexa.RecordController', 'StopRecording'], {}, messageId)

        })
    })
})

