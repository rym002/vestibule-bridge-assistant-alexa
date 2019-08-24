import { providersEmitter, responseRouter, topicHandler } from '@vestibule-link/bridge-assistant';
import { AssistantType, Providers, Shadow } from '@vestibule-link/iot-types';
import { thingShadow } from 'aws-iot-device-sdk';
import * as _ from 'lodash';
import { routeStateDelta } from '../state';
import stateDiff from '../state/statediff';
import { alexaConfig, createShadow } from './shadow';



class AlexaRouter {
    readonly assistant: AssistantType = "alexa";
    remoteShadow: Shadow = {};
    lastClientToken: string | undefined;
    pendingUpdates: ShadowUpdateHolder[] = [];
    shadowUpdates: Map<string, PromiseHolder> = new Map();
    constructor(readonly thingShadow: thingShadow) {
        thingShadow.on('message', topicHandler)
            .on('status', this.statusUpdate.bind(this))
            .on('delta', routeStateDelta);
        providersEmitter.on(this.assistant, this.providers.bind(this));
        responseRouter.on(this.assistant, this.sendResponse.bind(this));
    }

    sendStateUpdate(shadow: Shadow): Promise<void> {
        const promise = new Promise<void>((resolve, reject) => {
            if (this.lastClientToken) {
                this.pendingUpdates.push({
                    reject: reject,
                    resolve: resolve,
                    shadow: shadow
                });
            } else {
                shadow = stateDiff(this.remoteShadow, shadow);
                if (shadow) {
                    shadow.state = { ...shadow.state, ...{ desired: null } };
                    this.lastClientToken = this.thingShadow.update(alexaConfig.clientId, shadow);
                    this.shadowUpdates.set(this.lastClientToken, { reject: reject, resolve: resolve });
                } else {
                    resolve();
                }
            }
        })
        return promise;
    }

    sendResponse(topic: string, resp: string): void {
        this.thingShadow.publish(topic, resp);
    }

    disconnect(): void {
        this.thingShadow.end();
    }

    providers(providers: Providers<'alexa'>): void {
        this.sendStateUpdate({
            state: {
                reported: {
                    endpoints: providers
                }
            }
        }).catch(err => {
            console.log('Error Updating providers %o', err);
        })
    }

    statusUpdate(th: string, operation: string, token: string, stateObject: any) {
        const holder = this.shadowUpdates.get(token);
        if (holder) {
            this.shadowUpdates.delete(token);
            if (operation == 'accepted') {
                _.merge(this.remoteShadow, stateObject);
                holder.resolve();
            } else {
                holder.reject(stateObject);
            }
        }
        if (token == this.lastClientToken) {
            this.lastClientToken = undefined;
        }
        if (this.pendingUpdates.length > 0) {
            const nextUpdate = this.pendingUpdates.shift();
            this.sendStateUpdate(nextUpdate.shadow)
                .then(() => {
                    nextUpdate.resolve();
                }).catch(err => {
                    nextUpdate.reject(err);
                });
        }
    }
}

interface PromiseHolder {
    resolve: CallableFunction;
    reject: CallableFunction;
}
interface ShadowUpdateHolder extends PromiseHolder {
    shadow: Shadow
}

let router: AlexaRouter;
export async function init(): Promise<void> {
    const shadow = await createShadow();
    router = new AlexaRouter(shadow);
}
