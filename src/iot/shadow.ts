import { ThingShadowOptions, thingShadow } from "aws-iot-device-sdk";
import { topicConfig } from "@vestibule-link/iot-types";

export const alexaConfig = {
    certPath: process.env['CERT_PATH'],
    clientId: process.env['CLIENT_ID'],
    host: process.env['VESTIBULE_HOST']
}

const directive = topicConfig.root + alexaConfig.clientId + topicConfig.directive + '#';

function connectedPromise(shadow: thingShadow) {
    return (resolve: CallableFunction, reject: CallableFunction) => {
        console.time('shadowConnection');
        shadow.on('connect', () => {
            console.timeEnd('shadowConnection');
            const regPromise = new Promise(registrationPromise(shadow));
            const subPromise = new Promise(subscribePromise(shadow));
            Promise.all([regPromise, subPromise])
                .then(values => {
                    reconnected(shadow);
                    resolve();
                }).catch(err => {
                    resolve(err);
                });
        })
    }
}

function reconnected(shadow: thingShadow) {
    shadow.on('reconnect', () => {
        console.log('reconnect');
        shadow.unregister(alexaConfig.clientId);
    })
    shadow.on('offline', () => {
        console.log('offline');
        console.time('shadowConnection');
    })
    shadow.on('connect', () => {
        console.log('connect reconnect');
        console.timeEnd('shadowConnection');
        const regPromise = new Promise(registrationPromise(shadow));
        const subPromise = new Promise(subscribePromise(shadow));
        Promise.all([regPromise, subPromise])
            .then(values => {
                console.log('Reconnected');
            }).catch(err => {
                console.log('Reconnection Error %o', err);
            });
    })
}
function registrationPromise(shadow: thingShadow) {
    return (resolve: CallableFunction, reject: CallableFunction) => {
        console.time('shadowRegistration');
        shadow.register(alexaConfig.clientId, {}, (err) => {
            console.timeEnd('shadowRegistration');
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    }
}

function subscribePromise(shadow: thingShadow) {
    return (resolve: CallableFunction, reject: CallableFunction) => {
        console.time('subscribeTopic');
        shadow.subscribe(directive, { qos: 0 }, (err) => {
            console.timeEnd('subscribeTopic');
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    }
}

export async function createShadow(): Promise<thingShadow> {
    const deviceOptions: ThingShadowOptions = {
        keyPath: alexaConfig.certPath + '/vestibule.private.key',
        certPath: alexaConfig.certPath + '/vestibule.cert.pem',
        caPath: alexaConfig.certPath + '/AmazonRootCA1.pem',
        clientId: alexaConfig.clientId,
        host: alexaConfig.host,
        debug: true,
        reconnectPeriod: 4000,
        baseReconnectTimeMs: 4000
    }
    const shadow = new thingShadow(deviceOptions);
    const connPromise = new Promise(connectedPromise(shadow));
    await connPromise;
    return shadow;
}
